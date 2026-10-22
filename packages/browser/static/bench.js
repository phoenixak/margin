// In-browser benchmark: fills the /bench box with each real GitHub issue and counts Harper's and
// Margin's underlines (both use the CSS Custom Highlight API), duplicates and timings.
// Open http://localhost:5173/bench, then in the console:  await import('/bench.js')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ranges = (prefix) => [...CSS.highlights.keys()].filter((k) => k.startsWith(prefix)).flatMap((k) => [...CSS.highlights.get(k)]);
const overlap = (a, b) => a.compareBoundaryPoints(Range.END_TO_START, b) < 0 && a.compareBoundaryPoints(Range.START_TO_END, b) > 0;

const docs = await (await fetch('/bench-data')).json();
const box = document.getElementById('box');
const results = [];
for (const doc of docs) {
  box.focus();
  document.execCommand('selectAll', false);
  document.execCommand('delete', false);
  await sleep(1500);
  const t0 = performance.now();
  document.execCommand('insertText', false, doc.text);
  let first = null;
  let harperMs = null;
  let last = -1;
  let lastChange = performance.now();
  while (performance.now() - t0 < 90000) {
    await sleep(250);
    const m = ranges('margin-').length;
    if (harperMs === null && ranges('harper-').length) harperMs = Math.round(performance.now() - t0);
    if (m && first === null) first = Math.round(performance.now() - t0);
    if (m !== last) {
      last = m;
      lastChange = performance.now();
    }
    // Done once nothing has changed for 15 s (the 2 s idle delay plus a model call).
    if (performance.now() - lastChange > 15000 && performance.now() - t0 > 20000) break;
  }
  const m = ranges('margin-');
  const h = ranges('harper-');
  results.push({ name: doc.name, harper: h.length, margin: m.length, duplicates: m.filter((r) => h.some((x) => overlap(r, x))).length, harperMs, firstMarginMs: first });
  console.log(`${results.length}/${docs.length} ${doc.name}: Harper ${h.length}, Margin ${m.length}`);
}
const total = (k) => results.reduce((n, r) => n + r[k], 0);
console.log(`Done. Harper ${total('harper')}, Margin ${total('margin')}, duplicates ${total('duplicates')}. Copy this line back:`);
console.log(JSON.stringify(results));
