// ==UserScript==
// @name         draw.io SVG bitmap cache
// @namespace    https://github.com/HugoFiermein
// @version      0.4.0
// @description  Makes draw.io smooth with heavy SVG shape libraries: detailed SVG images in the shape panel, hover previews and on the canvas are shown through a cached bitmap instead of being re-rendered as vectors on every scroll / zoom frame. The diagram itself is not changed: files, export and print stay vector.
// @match        https://app.diagrams.net/*
// @match        https://embed.diagrams.net/*
// @match        https://*.draw.io/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

// draw.io Desktop: current versions no longer load external plugins; use patch-desktop.ps1 from this repo instead.
(function () {
  'use strict';

  var CFG = {
    panel: true,            // shape panel thumbnails + hover preview
    canvas: true,           // shapes on the drawing canvas
    minBytes: 4000,         // SVGs smaller than this are cheap, leave them alone
    panelOversample: 2,     // bitmap pixels per screen pixel in the panel
    canvasOversample: 2,     // ... and on the canvas
    maxSide: 4096,          // never make a bitmap larger than this (px); bigger shapes stay vector
    maxPixels: 8e6,
    settleMs: 220,          // after zoom stops, wait this long, then re-render bitmaps at the new size
    maxEntries: 400,
    urls: 'auto'            // 'blob' | 'data' | 'auto'. draw.io Desktop forbids blob: images (CSP img-src * data:), so it gets data: URLs
  };
  try { Object.assign(CFG, JSON.parse(localStorage.getItem('drawioSvgCache') || '{}')); } catch (e) { /* defaults */ }

  var XLINK = 'http://www.w3.org/1999/xlink';
  var DATA_URLS = CFG.urls === 'data' || (CFG.urls === 'auto' && (location.protocol === 'file:' || /Electron/i.test(navigator.userAgent) || !!window.mxIsElectron));
  var cache = new Map();              // svg data URI -> { w, h, url, pending, wantW, wantH }
  var source = new WeakMap();         // <image> element -> its original svg data URI
  var stats = { swapped: 0, rendered: 0, upgraded: 0, tooBig: 0, failed: 0 };
  var settleTimer = null;

  function hrefOf(img) { return img.getAttribute('xlink:href') || img.getAttribute('href') || ''; }

  function setHref(img, url) {
    img.setAttributeNS(XLINK, 'xlink:href', url);
    if (img.hasAttribute('href')) img.setAttribute('href', url);
  }

  function isHeavySvg(href) {
    return href.length >= CFG.minBytes && href.lastIndexOf('data:image/svg+xml', 0) === 0;
  }

  function inPanel(img) {
    return !!(img.closest && img.closest('.geSidebarContainer, .geSidebarTooltip, .geSidebar'));
  }

  // On-screen size of the image in CSS px (transform-aware, so rotation and zoom are handled).
  function screenSize(img) {
    var w = parseFloat(img.getAttribute('width')) || 0, h = parseFloat(img.getAttribute('height')) || 0;
    var m = img.getScreenCTM && img.getScreenCTM();
    if (!m || !w || !h) return null;
    return { w: w * Math.hypot(m.a, m.b), h: h * Math.hypot(m.c, m.d) };
  }

  function render(href, pxW, pxH) {
    return new Promise(function (resolve, reject) {
      var im = new Image();
      im.onload = function () {
        try {
          var c = document.createElement('canvas');
          c.width = pxW; c.height = pxH;
          c.getContext('2d').drawImage(im, 0, 0, pxW, pxH);
          if (DATA_URLS) resolve(c.toDataURL('image/png'));
          else c.toBlob(function (b) { b ? resolve(URL.createObjectURL(b)) : reject(new Error('toBlob')); }, 'image/png');
        } catch (e) { reject(e); }
      };
      im.onerror = function () { reject(new Error('svg load')); };
      im.src = href;
    });
  }

  function apply(img, href, entry) {
    if (source.get(img) !== href || !img.isConnected) return;
    if (hrefOf(img) !== entry.url) { setHref(img, entry.url); stats.swapped++; }
  }

  // (Re)render the bitmap for `href` at the largest size currently wanted, then update every element showing it.
  function ensure(href, entry) {
    if (entry.pending) return;
    var w = entry.wantW, h = entry.wantH;
    entry.pending = true;
    render(href, w, h).then(function (url) {
      var old = entry.url;
      entry.url = url; entry.w = w; entry.h = h; entry.pending = false;
      stats.rendered++;
      var all = document.querySelectorAll('image');
      for (var i = 0; i < all.length; i++) if (source.get(all[i]) === href) apply(all[i], href, entry);
      if (old) { stats.upgraded++; if (!DATA_URLS) window.setTimeout(function () { URL.revokeObjectURL(old); }, 2000); }
      if (entry.wantW > entry.w || entry.wantH > entry.h) ensure(href, entry);
    }).catch(function () { entry.pending = false; entry.failed = true; stats.failed++; });
  }

  function isBitmapUrl(u) { return u.lastIndexOf('blob:', 0) === 0 || u.lastIndexOf('data:image/png', 0) === 0; }

  // Decide what one <image> should show right now: the cached bitmap, or the real vector when zoomed in far.
  // settled = the view is at rest, so it is worth rendering a sharper bitmap.
  function handle(img, settled) {
    var cur = hrefOf(img);
    var href = isHeavySvg(cur) ? cur : source.get(img);
    if (!href) return;
    if (cur !== href && !isBitmapUrl(cur)) { source.delete(img); return; }   // draw.io put something else here
    var panel = inPanel(img);
    if (panel ? !CFG.panel : !CFG.canvas) return;
    var s = screenSize(img);
    if (!s || s.w < 1 || s.h < 1) return;
    var k = (window.devicePixelRatio || 1) * (panel ? CFG.panelOversample : CFG.canvasOversample);
    var pxW = Math.round(s.w * k), pxH = Math.round(s.h * k);
    var tooBig = function () { return pxW > CFG.maxSide || pxH > CFG.maxSide || pxW * pxH > CFG.maxPixels; };
    if (tooBig()) {                                       // no room for oversampling: try screen resolution
      k = window.devicePixelRatio || 1;
      pxW = Math.round(s.w * k); pxH = Math.round(s.h * k);
    }
    source.set(img, href);
    if (tooBig()) {
      // zoomed in far: a bitmap would be huge and only a few shapes fit on screen anyway -> real vector, sharp
      if (cur !== href) { setHref(img, href); stats.tooBig++; }
      return;
    }
    var entry = cache.get(href);
    if (!entry) {
      if (cache.size >= CFG.maxEntries) return;
      entry = { w: 0, h: 0, url: null, pending: false, wantW: pxW, wantH: pxH };
      cache.set(href, entry);
    }
    if (entry.failed) return;
    if (entry.url) apply(img, href, entry);              // show what we have right away (may be soft while zooming)
    var needBigger = entry.w < pxW * 0.95 || entry.h < pxH * 0.95;
    if (!entry.url || (needBigger && (settled || panel))) {
      entry.wantW = pxW; entry.wantH = pxH;
      ensure(href, entry);
    } else if (needBigger) {
      scheduleSettle();
    }
  }

  function tracked() {
    var all = document.getElementsByTagName('image'), out = [];
    for (var i = 0; i < all.length; i++) if (source.has(all[i])) out.push(all[i]);
    return out;
  }

  // After the view stops changing, bring every bitmap up to the current zoom.
  function scheduleSettle() {
    if (settleTimer) window.clearTimeout(settleTimer);
    settleTimer = window.setTimeout(function () {
      settleTimer = null;
      var list = tracked();
      for (var i = 0; i < list.length; i++) handle(list[i], true);
    }, CFG.settleMs);
  }

  // draw.io can zoom without touching the <image> elements (it rescales a parent), so no DOM change tells us
  // about it. Look at the on-screen size of the tracked images a few times per second instead.
  var lastSig = '';
  function watchView() {
    if (document.hidden) return;
    var list = tracked(), sig = 0;
    for (var i = 0; i < list.length; i++) {
      var s = screenSize(list[i]);
      if (s) sig += s.w + s.h;
    }
    sig = list.length + ':' + Math.round(sig);
    if (sig === lastSig) return;
    lastSig = sig;
    for (var j = 0; j < list.length; j++) handle(list[j], false);   // switches far-zoomed shapes to vector at once
    scheduleSettle();
  }

  function scan(node) {
    if (node.nodeType !== 1) return;
    if (node.localName === 'image') handle(node, false);
    else if (node.firstElementChild && node.getElementsByTagName) {
      var list = node.getElementsByTagName('image');
      for (var i = 0; i < list.length; i++) handle(list[i], false);
    }
  }

  function start() {
    new MutationObserver(function (records) {
      for (var i = 0; i < records.length; i++) {
        var r = records[i];
        if (r.type === 'attributes') { if (r.target.localName === 'image') handle(r.target, false); }
        else for (var j = 0; j < r.addedNodes.length; j++) scan(r.addedNodes[j]);
      }
    }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['href', 'xlink:href', 'width', 'height'] });
    scan(document.body);
    window.setInterval(watchView, 200);
    window.drawioSvgCache = { config: CFG, stats: stats, cache: cache, refresh: function () { scan(document.body); scheduleSettle(); } };
  }

  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
})();
