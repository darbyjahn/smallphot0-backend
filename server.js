const express = require("express");
const fileUpload = require("express-fileupload");
const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");

const app = express();
const PORT = 3000;

/* ---------- MIDDLEWARE ---------- */
app.use(express.json());
app.use(fileUpload());
app.use(express.static("public"));
app.use("/galleries", express.static("galleries"));

/* ---------- DATA FILE ---------- */
const GALLERIES_FILE = "galleries.json";

/* ---------- ENSURE DATA EXISTS ---------- */
if (!fs.existsSync(GALLERIES_FILE)) {
  fs.writeFileSync(
    GALLERIES_FILE,
    JSON.stringify({ users: [] }, null, 2)
  );
}

/* ---------- HELPERS ---------- */
function loadGalleries() {
  return JSON.parse(fs.readFileSync(GALLERIES_FILE));
}

function saveGalleries(data) {
  fs.writeFileSync(GALLERIES_FILE, JSON.stringify(data, null, 2));
}

/* =========================================================
   CREATE GALLERY (FROM HOMEPAGE MODAL)
   ========================================================= */
app.post("/api/create", (req, res) => {
  try {
    const { username, title, bg, text } = req.body;

    console.log("📥 CREATE REQUEST:", req.body);

    if (!username || !title) {
      return res.status(400).json({ error: "Missing fields" });
    }

    const data = loadGalleries();

    if (data.users.find(u => u.username === username)) {
      return res.status(400).json({ error: "Gallery already exists" });
    }

    const base = path.join("galleries", username);
    const mediaDir = path.join(base, "media");

    fs.mkdirSync(mediaDir, { recursive: true });

    const galleryData = {
      title,
      bg_color: bg || "#ffffff",
      text_color: text || "#000000",
      items: []
    };

    fs.writeFileSync(
      path.join(base, "gallery.json"),
      JSON.stringify(galleryData, null, 2)
    );

    const templatePath = path.join(__dirname, "public", "gallery.html");

    if (!fs.existsSync(templatePath)) {
      console.error("❌ gallery.html missing:", templatePath);
      return res.status(500).json({
        error: "gallery.html template missing"
      });
    }

    fs.copyFileSync(
      templatePath,
      path.join(base, "index.html")
    );

    data.users.push({ username, title });
    saveGalleries(data);

    res.json({ success: true });

  } catch (err) {
    console.error("❌ CREATE FAILED:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/* =========================================================
   UPLOAD MEDIA (IMAGES + VIDEO)
   ========================================================= */
app.post("/api/upload/:user", async (req, res) => {
  const user = req.params.user;
  const files = req.files?.files;

  if (!files) {
    return res.status(400).json({ error: "No files uploaded" });
  }

  const base = path.join("galleries", user);
  const mediaDir = path.join(base, "media");
  const galleryFile = path.join(base, "gallery.json");

  if (!fs.existsSync(galleryFile)) {
    return res.status(404).json({ error: "Gallery not found" });
  }

  const gallery = JSON.parse(fs.readFileSync(galleryFile));
  const batch = Date.now();
  const uploadList = Array.isArray(files) ? files : [files];

  uploadList.forEach((file, index) => {
    const ext = path.extname(file.name).toLowerCase();
    const safeName = `${batch}_${index}_${file.name}`;
    const outputPath = path.join(mediaDir, safeName);

    /* ---------- VIDEO ---------- */
    if (ext === ".avi") {
      const mp4Name = safeName.replace(".avi", ".mp4");
      const mp4Path = path.join(mediaDir, mp4Name);

      file.mv(outputPath, err => {
        if (err) return console.error(err);

        exec(
          `ffmpeg -i "${outputPath}" -movflags +faststart -c:v libx264 -preset fast -crf 23 "${mp4Path}"`,
          () => {
            fs.unlinkSync(outputPath);
          }
        );
      });

      gallery.items.push({
        stored: mp4Name,
        batch,
        seq: index,
        type: "video"
      });
    }

    /* ---------- IMAGE ---------- */
    else {
      file.mv(outputPath);
      gallery.items.push({
        stored: safeName,
        batch,
        seq: index,
        type: "image"
      });
    }
  });

  fs.writeFileSync(galleryFile, JSON.stringify(gallery, null, 2));
  res.json({ success: true });
});

/* =========================================================
   START SERVER
   ========================================================= */
app.listen(PORT, () => {
  console.log(`✅ SmallPhotos running at http://localhost:${PORT}`);
});
