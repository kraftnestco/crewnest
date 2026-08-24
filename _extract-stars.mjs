import fs from "fs";

const h = fs.readFileSync("c:/Users/Admin/Desktop/crewnest/public/clerknest-assets/index.html", "utf8");
const i = h.indexOf("Loved by");
console.log("idx", i);
console.log(h.slice(i - 500, i + 300));
for (const pat of ["text-gold", "color-gold", "color-glow", "e6a33c", "f0b84a", "hero-photo"]) {
  const idx = h.indexOf(pat);
  console.log(pat, idx >= 0 ? h.slice(idx - 60, idx + 120) : "NOT FOUND");
}
