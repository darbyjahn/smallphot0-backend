const express = require("express");
const fileUpload = require("express-fileupload");
const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");

const app = express();
const PORT = process.env.PORT || 3000;

/* ---------- MIDDLEWARE ---------- */
app.use(express.json());
app.use(fileUpload());
app.use(express.static(path.join(__dirname, "public")));
app.use("/galleries", express.static(path.join(__dirname, "galleries")));

/* ---------- ROOT ---------- */
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

/* ---------- DATA FILE ---------- */
const GALLERIES_FILE = path.join(__dirname, "galleries.json");
if (!fs.existsSync(GALLERIES_FILE)) {
  fs.writeFileSync(GALLERIES_FILE, JSON.stringify({ users: [] }, null, 2));
}

/* ---------- HELPERS ---------- */
function loadGalleries() {
  try {
    return JSON.parse(fs.readFileSync(GALLERIES_FILE, "utf-8"));
  } catch {
    return { users: [] };
  }
}
function saveGalleries(data) {
  fs.writeFileSync(GALLERIES_FILE, JSON.stringify(data, null, 2));
}

/* ---------- LIST GALLERIES ---------- */
app.get("/api/galleries", (req, res) => {
  const data = loadGalleries();
  res.json(data.users || []);
});

/* ---------- CREATE GALLERY ---------- */
app.post("/api/create", (req, res) => {
  const { username, title, bg, text } = req.body;
  if (!username || !title) return res.status(400).json({ error: "Missing fields" });

  const data = loadGalleries();
  if (!data.users) data.users = [];
  if (data.users.find(u => u.username === username))
    return res.status(400).json({ error: "Gallery already exists" });

  const base = path.join(__dirname, "galleries", username);
  const mediaDir = path.join(base, "media");
  fs.mkdirSync(mediaDir, { recursive: true });

  fs.writeFileSync(
    path.join(base, "gallery.json"),
    JSON.stringify({
      title,
      bg_color: bg || "#ffffff",
      text_color: text || "#000000",
      items: []
    }, null, 2)
  );

  const template = path.join(__dirname, "public", "gallery.html");
  fs.copyFileSync(template, path.join(base, "index.html"));

  data.users.push({ username, title });
  saveGalleries(data);

  res.json({ success: true });
});

/* ---------- DELETE GALLERY ---------- */
app.delete("/api/delete/:user", (req, res) => {
  const user = req.params.user;
  const base = path.join(__dirname, "galleries", user);
  if (!fs.existsSync(base)) return res.status(404).json({ error: "Gallery not found" });

  fs.rmSync(base, { recursive: true, force: true });

  let data = loadGalleries();
  data.users = data.users.filter(u => u.username !== user);
  saveGalleries(data);

  res.json({ success: true });
});

/* ---------- UPLOAD MEDIA ---------- */
app.post("/api/upload/:user", (req, res) => {
  const user = req.params.user;
  const files = req.files?.files;
  if (!files) return res.status(400).json({ error: "No files uploaded" });

  const base = path.join(__dirname, "galleries", user);
  const mediaDir = path.join(base, "media");
  const galleryFile = path.join(base, "gallery.json");
  if (!fs.existsSync(galleryFile)) return res.status(404).json({ error: "Gallery not found" });

  const gallery = JSON.parse(fs.readFileSync(galleryFile));
  const uploadList = Array.isArray(files) ? files : [files];
  const batch = Date.now();

  uploadList.forEach((file, i) => {
    const ext = path.extname(file.name).toLowerCase();
    const safeName = `${batch}_${i}_${file.name}`;
    const outputPath = path.join(mediaDir, safeName);

    file.mv(outputPath, err => {
      if (err) console.error("FILE MOVE ERROR:", err);
    });

    gallery.items.push({
      stored: safeName,
      batch,
      seq: i,
      type: ext === ".avi" ? "video" : "image"
    });
  });

  fs.writeFileSync(galleryFile, JSON.stringify(gallery, null, 2));
  res.json({ success: true });
});

/* ---------- START SERVER ---------- */
app.listen(PORT, () => console.log(`✅ SmallPhotos running on port ${PORT}`));
