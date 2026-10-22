'use strict';
/* WBS-30 · Security boundaries — security posture for the renderer.
 *
 * 19 §S and 07 §2: JuQode does NOT claim OS-level containment. What is enforced here is an
 * in-app boundary — the renderer cannot reach Node, cannot navigate away, and cannot open
 * windows. That is a real boundary and it is not process isolation. Do not describe it as one.
 *
 * WBS-00 Spike A measured Electron 44's defaults as already safe; these are set explicitly
 * anyway so the posture survives a future default change.
 */

const WEB_PREFERENCES = Object.freeze({
  contextIsolation: true,
  nodeIntegration: false,
  nodeIntegrationInWorker: false,
  nodeIntegrationInSubFrames: false,
  sandbox: true,
  webSecurity: true,
  allowRunningInsecureContent: false,
  experimentalFeatures: false,
  webviewTag: false,
  spellcheck: false,
});

/** Refuse every navigation away from our own file, and every new window. */
function lockNavigation(contents, allowedUrl) {
  contents.on('will-navigate', (event, url) => {
    if (url !== allowedUrl) event.preventDefault();
  });
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-attach-webview', (event) => event.preventDefault());
}

/**
 * Offline enforcement at the SESSION layer.
 * Spike A finding O-1: `--proxy-server` blocks the renderer but NOT main-process net.fetch
 * (reproduced 3/3). Only webRequest blocks both. This app makes no external requests at all;
 * this cancels anything that would, and records it so a test can assert zero.
 */
function enforceLocalOnly(session) {
  const attempts = [];
  let blocked = 0;
  session.webRequest.onBeforeRequest((details, callback) => {
    const url = details.url || '';
    const local = url.startsWith('file:') || url.startsWith('devtools:') ||
                  url.startsWith('data:') || url.startsWith('blob:') || url.startsWith('about:');
    if (!local) {
      /* Bounded: a renderer can trigger this, and an unbounded array in the main process is
       * an allocation it controls. The count is what the test asserts, so keep counting. */
      if (attempts.length < 100) attempts.push(url);
      blocked += 1;
      return callback({ cancel: true });
    }
    callback({ cancel: false });
  });
  const read = () => attempts.slice();
  read.count = () => blocked;
  return read;
}

/* Electron grants every permission request unless a handler says otherwise. The UI uses exactly one: copying text
 * (`navigator.clipboard.writeText`, sc04.js and file-summary.js), which Chromium asks for as 'clipboard-sanitized-write'. */
const ALLOWED_PERMISSIONS = Object.freeze(['clipboard-sanitized-write']);

function denyPermissions(session) {
  session.setPermissionRequestHandler((_contents, permission, callback) => callback(ALLOWED_PERMISSIONS.includes(permission)));
  session.setPermissionCheckHandler((_contents, permission) => ALLOWED_PERMISSIONS.includes(permission));
}

/* An IPC call is ours only if its frame is the top frame of OUR page. A frame that reports no URL (destroyed
 * mid-call) or no frame at all stays accepted - refusing it would drop legitimate calls; navigation is locked to
 * `appUrl` anyway, so a frame at any other URL (devtools://, a file:// page, http) is refused. */
function trustedSender(e, appUrl) {
  const f = e && e.senderFrame;
  if (!f) return true;
  if (f.parent) return false;
  if (typeof f.url !== 'string' || !f.url) return true;
  return f.url.split(/[?#]/)[0] === appUrl;
}

module.exports = { trustedSender, WEB_PREFERENCES, lockNavigation, enforceLocalOnly, denyPermissions };
