const express = require("express");
const fileUpload = require("express-fileupload");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

/* ---------- MIDDLEWARE ---------- */
app.use(express.json());
app.use(fileUpload());
app.use(express.static(path.join(__dirname, "public")));

/* ---------- DATA FILE ---------- */
const GALLERIES_FILE = path.join(__dirname, "galleries.json");

/* ---------- ENSURE DATA EXISTS ---------- */
if (!fs.existsSync(GALLERIES_FILE)) {
  fs.writeFileSync(GALLERIES_FILE, JSON.stringify({ users: [] }, null, 2));
}

/* ---------- HELPERS ---------- */
function loadGalleries() {
  try {
    return JSON.parse(fs.readFileSync(GALLERIES_FILE, "utf-8"));
  } catch (err) {
    console.error("❌ Error loading galleries:", err);
    return { users: [] };
  }
}

function saveGalleries(data) {
  try {
    fs.writeFileSync(GALLERIES_FILE, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error("❌ Error saving galleries:", err);
  }
}

/* =========================================================
   MAIN PAGE
   ========================================================= */
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

/* =========================================================
   LIST GALLERIES API
   ========================================================= */
app.get("/api/galleries", (req, res) => {
  const data = loadGalleries();
  res.json(data.users);
});

/* =========================================================
   CREATE GALLERY
   ========================================================= */
app.post("/api/create", (req, res) => {
  try {
    const { username, title, bg, text } = req.body;
    if (!username || !title) return res.status(400).json({ error: "Missing fields" });

    const data = loadGalleries();
    if (!data.users) data.users = [];
    if (data.users.find(u => u.username === username))
      return res.status(400).json({ error: "Gallery already exists" });

    // Create gallery folder
    const base = path.join(__dirname, "galleries", username);
    const mediaDir = path.join(base, "media");
    fs.mkdirSync(mediaDir, { recursive: true });

    // Create gallery.json
    const galleryData = {
      title,
      bg_color: bg || "#ffffff",
      text_color: text || "#000000",
      items: []
    };
    fs.writeFileSync(path.join(base, "gallery.json"), JSON.stringify(galleryData, null, 2));

    // Copy gallery template
    const template = path.join(__dirname, "public", "gallery.html");
    if (!fs.existsSync(template)) return res.status(500).json({ error: "Gallery template missing" });
    fs.copyFileSync(template, path.join(base, "index.html"));

    // Add to galleries.json
    data.users.push({ username, title });
    saveGalleries(data);

    res.json({ success: true });
  } catch (err) {
    console.error("❌ CREATE FAILED:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/* =========================================================
   UPLOAD MEDIA
   ========================================================= */
app.post("/api/upload/:user", (req, res) => {
  try {
    const user = req.params.user;
    const files = req.files?.files;
    if (!files) return res.status(400).json({ error: "No files uploaded" });

    const base = path.join(__dirname, "galleries", user);
    const mediaDir = path.join(base, "media");
    const galleryFile = path.join(base, "gallery.json");

    if (!fs.existsSync(galleryFile)) return res.status(404).json({ error: "Gallery not found" });

    const gallery = JSON.parse(fs.readFileSync(galleryFile));
    const uploadList = Array.isArray(files) ? files : [files];

    uploadList.forEach((file, index) => {
      const ext = path.extname(file.name).toLowerCase();
      const safeName = `${Date.now()}_${index}_${file.name}`;
      const outputPath = path.join(mediaDir, safeName);

      file.mv(outputPath, err => {
        if (err) console.error("❌ FILE MOVE ERROR:", err);
      });

      gallery.items.push({ stored: safeName, type: ext === ".avi" ? "video" : "image" });
    });

    fs.writeFileSync(galleryFile, JSON.stringify(gallery, null, 2));
    res.json({ success: true });
  } catch (err) {
    console.error("❌ UPLOAD FAILED:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/* =========================================================
   DELETE GALLERY
   ========================================================= */
app.delete("/api/delete/:user", (req, res) => {
  try {
    const user = req.params.user;
    const base = path.join(__dirname, "galleries", user);
    if (!fs.existsSync(base)) return res.status(404).json({ error: "Gallery not found" });

    fs.rmSync(base, { recursive: true, force: true });

    const data = loadGalleries();
    data.users = data.users.filter(u => u.username !== user);
    saveGalleries(data);

    res.json({ success: true });
  } catch (err) {
    console.error("❌ DELETE FAILED:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/* =========================================================
   SERVE GALLERY PAGES
   ========================================================= */
app.use("/galleries/:user", (req, res, next) => {
  const userFolder = path.join(__dirname, "galleries", req.params.user);
  const indexFile = path.join(userFolder, "index.html");
  if (fs.existsSync(indexFile)) {
    res.sendFile(indexFile);
  } else {
    res.status(404).send("Gallery not found");
  }
});

// Serve static media inside galleries
app.use("/galleries", express.static(path.join(__dirname, "galleries")));

/* =========================================================
   START SERVER
   ========================================================= */
app.listen(PORT, () => console.log(`✅ SmallPhotos running on port ${PORT}`));
