// SPDX-License-Identifier: GPL-2.0-or-later
import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class BetterWorkspaceThumbnailsPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        const adjustment = new Gtk.Adjustment({
            lower: 1,
            upper: 4,
            step_increment: 0.1,
            page_increment: 0.5,
        });
        settings.bind('thumbnail-scale', adjustment, 'value', Gio.SettingsBindFlags.DEFAULT);
        const scale = new Gtk.Scale({
            adjustment,
            digits: 1,
            draw_value: true,
            value_pos: Gtk.PositionType.LEFT,
            hexpand: true,
            width_request: 240,
            valign: Gtk.Align.CENTER,
        });
        for (const mark of [1, 2, 3, 4])
            scale.add_mark(mark, Gtk.PositionType.BOTTOM, null);

        const sizeRow = new Adw.ActionRow({
            title: 'Thumbnail size',
            subtitle: 'Times GNOME’s default size. Applies right away, even with the overview open.',
        });
        sizeRow.add_suffix(scale);

        const dragRow = new Adw.SwitchRow({
            title: 'Drag the whole thumbnail',
            subtitle: 'Reorder by dragging a thumbnail from anywhere on it, with no grip. Windows can no longer be dragged out of the thumbnails.',
        });
        settings.bind('drag-whole-thumbnail', dragRow, 'active', Gio.SettingsBindFlags.DEFAULT);

        const group = new Adw.PreferencesGroup({title: 'Thumbnails'});
        group.add(sizeRow);
        group.add(dragRow);
        const page = new Adw.PreferencesPage();
        page.add(group);
        window.add(page);
    }
}
