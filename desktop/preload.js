// Bridge between the setup page and the main process; the web app from the relay needs none of this.
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

// Only the bundled setup page (file://) gets the bridge: the web app comes from the relay, and a relay that is not
// trustworthy must not be able to point the app at another address for good. main.js checks the sender as well.
if (location.protocol === 'file:') {
    contextBridge.exposeInMainWorld('openfolkDesktop', {
        saveAddress: (url) => ipcRenderer.invoke('save-address', url),
        chooseLocal: () => ipcRenderer.invoke('choose-local'),
        joinServer: (link) => ipcRenderer.invoke('join-server', link),
        info: () => ipcRenderer.invoke('info'),
    });
}
