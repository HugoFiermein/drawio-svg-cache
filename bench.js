// Paste into the DevTools console of draw.io with a diagram open that contains your heavy SVG shapes.
// Run once with the script installed and once without, compare the numbers. The window must be visible.
(async function () {
  var ui; Draw.loadPlugin(function (u) { ui = u; });
  var graph = ui.editor.graph, c = graph.container, scale0 = graph.view.scale;
  var raf = function () { return new Promise(function (r) { requestAnimationFrame(r); }); };
  var q = function (a, p) { a = a.slice().sort(function (x, y) { return x - y; }); return +a[Math.floor(a.length * p)].toFixed(1); };
  async function run(step) {
    var t = [], last = performance.now();
    for (var i = 0; i < 120; i++) { step(i); await raf(); var n = performance.now(); t.push(n - last); last = n; }
    return { 'median ms': q(t, 0.5), 'p95 ms': q(t, 0.95), 'avg fps': +(1000 * t.length / t.reduce(function (a, b) { return a + b; })).toFixed(1) };
  }
  var out = {};
  out.zoom = await run(function (i) { graph.zoomTo(0.3 + (i < 60 ? i : 120 - i) * 0.015); });
  graph.zoomTo(0.6); await raf();
  out['vertical scroll'] = await run(function (i) { c.scrollTop += i < 60 ? 20 : -20; });
  out['horizontal scroll'] = await run(function (i) { c.scrollLeft += i < 60 ? 20 : -20; });
  graph.zoomTo(scale0);
  console.table(out);
})();
