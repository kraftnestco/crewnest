const fs = require("fs");
const html = fs.readFileSync(
  "c:/Users/Admin/Desktop/crewnest/public/clerknest-assets/index.html",
  "utf8",
);
const needle = "Social Media Automation Platform";
const idx = html.indexOf(needle);
const start = Math.max(0, idx - 1200);
const end = Math.min(html.length, idx + 400);
fs.writeFileSync(
  "c:/Users/Admin/Desktop/crewnest/_hero-snip.txt",
  html.slice(start, end),
);
console.log("wrote", end - start, "chars from", start);
