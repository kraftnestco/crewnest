const fs = require("fs");
const t = fs.readFileSync("public/clerknest-assets/index.html", "utf8");

const markers = [
  "function Ie",
  "function Le",
  "function Re",
  "Found it in your catalogue",
  "Answered from your catalogue",
  "Matched from your product list",
  "msg1:",
  "msg2:",
  "Unified Inbox",
  "Human Handoff",
];

for (const m of markers) {
  let i = 0;
  let c = 0;
  while ((i = t.indexOf(m, i + 1)) !== -1 && c < 3) {
    c++;
    const start = Math.max(0, i - 40);
    const end = Math.min(t.length, i + m.length + 300);
    console.log(`\n=== ${m} @ ${i} ===`);
    console.log(t.slice(start, end).replace(/\s+/g, " "));
  }
  if (!c) console.log(`\n(none) ${m}`);
}
