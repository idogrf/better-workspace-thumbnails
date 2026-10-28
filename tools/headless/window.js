// A plain GTK window for the headless tests: dynamic workspaces only keep a
// workspace that holds a window.
import Gtk from 'gi://Gtk?version=4.0';

const app = new Gtk.Application({application_id: 'io.github.idogrf.BetterWorkspaceThumbnailsTestWindow'});
app.connect('activate', () => {
    new Gtk.ApplicationWindow({application: app, title: 'thumbnails test',
        default_width: 400, default_height: 300}).present();
});
app.run([]);
