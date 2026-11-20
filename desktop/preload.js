// Bridge between the setup page and the main process; the web app needs only the password typed there.
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

// Only the bundled setup page (file://) gets the bridge: the web app comes from the relay, and a relay that is not
// trustworthy must not be able to point the app at another address for good. main.js checks the sender as well.
if (location.protocol === 'file:') {
    contextBridge.exposeInMainWorld('openfolkDesktop', {
        saveAddress: (url, password) => ipcRenderer.invoke('save-address', url, password),
        chooseLocal: (folders) => ipcRenderer.invoke('choose-local', folders),
        foldersInfo: () => ipcRenderer.invoke('folders-info'),
        pickFolder: () => ipcRenderer.invoke('folders-pick'),
        saveFolders: (list) => ipcRenderer.invoke('folders-save', list),
        joinServer: (link) => ipcRenderer.invoke('join-server', link),
        qrJoinStart: (url) => ipcRenderer.invoke('qr-join-start', url),
        qrJoinStop: () => ipcRenderer.invoke('qr-join-stop'),
        onQrJoin: (handler) => ipcRenderer.on('qr-join', (e, state) => handler(state)),
        machineSetup: (folders) => ipcRenderer.invoke('machine-setup', folders),
        machineDrop: () => ipcRenderer.invoke('machine-drop'),
        aiStatus: () => ipcRenderer.invoke('ai-status'),
        aiLogin: (engine) => ipcRenderer.invoke('ai-login', engine),
        onAiState: (handler) => ipcRenderer.on('ai-state', (e, state) => handler(state)),
        aiKey: (key) => ipcRenderer.invoke('ai-key', key),
        aiTry: () => ipcRenderer.invoke('ai-try'),
        aiSkip: () => ipcRenderer.invoke('ai-skip'),
        aiCancel: () => ipcRenderer.invoke('ai-cancel'),
        info: () => ipcRenderer.invoke('info'),
    });
} else if (location.protocol === 'openfolk:') {
    // The app's own web app (bundled, not a relay's page): the password of the setup page, once
    // … and the computer the window runs on: whether it is still to be set up at the relay, the end-to-end key for
    // its backend, the relay's invitation (webapp/js/platform.js desktopMachine)
    contextBridge.exposeInMainWorld('openfolkDesktop', {
        takePassword: (relay) => ipcRenderer.invoke('take-password', relay),
        machineWanted: (relay) => ipcRenderer.invoke('machine-wanted', relay),
        machineKey: (relay, key) => ipcRenderer.invoke('machine-key', relay, key),
        machineOffer: (offer) => ipcRenderer.invoke('machine-offer', offer),
        // While the app signs in out of sight (main.js signInAway): nothing to set up here, or the user is needed
        machineNone: () => ipcRenderer.invoke('machine-none'),
        signInNeeded: (message, code) => ipcRenderer.invoke('sign-in-needed', message, code),
    });
}
