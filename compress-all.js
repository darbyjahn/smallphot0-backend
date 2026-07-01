const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const ROOT = "/var/data/galleries";

async function processImage(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (![".jpg", ".jpeg", ".png"].includes(ext)) return;

  const dir = path.dirname(filePath);
  const base = path.basename(filePath, ext);

  const thumb = path.join(dir, "thumb_" + base + ".jpg");
  const webp = path.join(dir, base + ".webp");

  try {
    // thumbnail
    await sharp(filePath)
      .resize(500, 500, { fit: "inside" })
      .jpeg({ quality: 75 })
      .toFile(thumb);

    // webp copy
    await sharp(filePath)
      .resize(2000, 2000, { fit: "inside" })
      .webp({ quality: 80 })
      .toFile(webp);

    console.log("Processed:", filePath);
  } catch (e) {
    console.error("Error:", filePath, e.message);
  }
}

function walk(dir) {
  for (const item of fs.readdirSync(dir)) {
    const full = path.join(dir, item);
    if (fs.statSync(full).isDirectory()) walk(full);
    else processImage(full);
  }
}

walk(ROOT);

console.log("DONE (non-destructive mode)");