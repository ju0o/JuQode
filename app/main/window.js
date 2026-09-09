'use strict';
const path = require('node:path');
const { BrowserWindow } = require('electron');
const { WEB_PREFERENCES, lockNavigation } = require('./security');

const RENDERER = path.join(__dirname, '..', 'renderer', 'index.html');

/**
 * Creates the one window. 14 §5 and 21 WBS-01: exactly one window, no tabs, no second surface.
 *
 * Spike A finding S-1: `ready-to-show` did not fire on 1 of 10 runs. Gating show() on it alone
 * can leave the window hidden forever, so a timeout fallback shows it regardless.
 */
function createWindow({ onShown } = {}) {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 880,
    minHeight: 600,
    show: false,
    backgroundColor: '#eef0f4',      /* light --board; repainted by CSS immediately */
    title: 'JuQode',
    webPreferences: {
      ...WEB_PREFERENCES,
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
    },
  });

  lockNavigation(win.webContents, `file://${RENDERER}`);

  let shown = false;
  const show = (via) => {
    if (shown || win.isDestroyed()) return;
    shown = true;
    clearTimeout(timer);
    win.show();
    if (onShown) onShown(via);
  };

  const timer = setTimeout(() => show('timeout-fallback'), 3000);
  win.once('ready-to-show', () => show('ready-to-show'));
  win.on('closed', () => clearTimeout(timer));

  win.loadFile(RENDERER);
  return win;
}

module.exports = { createWindow, RENDERER };
