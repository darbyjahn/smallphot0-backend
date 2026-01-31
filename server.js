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

// Serve site
app.use(express.static(path.join(__dirname, "public")));
app.use("/galleries", express.static(path.join(__dirname, "public", "galleries")));

/* ---------- ROOT ---------- */
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

/* ---------- DATA FILE ---------- */
const GALLERIES_FILE = path.join(__dirname, "galleries.json");

if (!fs.existsSync(GALLERIES_FILE)) {
  fs.writeFileSync(GALLERIES_FILE, JSON.stringify({ users: [] }, null, 2));
}

const loadGalleries = () =>
  JSON.parse(fs.readFileSync(GALLERIES_FILE, "utf8"));

const saveGalleries = data =>
  fs.writeFileSync(GALLERIES_FILE, JSON.stringify(data, null, 2));

/* =========================================================
   LIST GALLERIES
   ========================================================= */
app.get("/api/galleries", (req, res) => {
  try {
    res.json(loadGalleries().users);
  } catch {
    res.status(500).json({ error: "Server error" });
  }
});

/* =========================================================
   CREATE GALLERY
   ========================================================= */
app.post("/api/create", (req, res) => {
  try {
    const { username, title, bg, text } = req.body;
    if (!username || !title)
      return res.status(400).json({ error: "Missing fields" });

    const data = loadGalleries();
    if (data.users.find(u => u.username === username))
      return res.status(400).json({ error: "Gallery already exists" });

    const base = path.join(__dirname, "public", "galleries", username);
    const mediaDir = path.join(base, "media");

    fs.mkdirSync(mediaDir, { recursive: true });

    fs.writeFileSync(
      path.join(base, "gallery.json"),
      JSON.stringify(
        {
          title,
          bg_color: bg || "#ffffff",
          text_color: text || "#000000",
          items: []
        },
        null,
        2
      )
    );

    fs.copyFileSync(
      path.join(__dirname, "public", "gallery.html"),
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
   DIRECT NAV
   ========================================================= */
app.get("/galleries/:user", (req, res) => {
  const file = path.join(
    __dirname,
    "public",
    "galleries",
    req.params.user,
    "index.html"
  );

  if (fs.existsSync(file)) {
    res.sendFile(file);
  } else {
    res.status(404).send("Gallery not found");
  }
});

/* =========================================================
   DELETE GALLERY
   ========================================================= */
app.delete("/api/delete/:user", (req, res) => {
  try {
    const base = path.join(__dirname, "public", "galleries", req.params.user);

    if (!fs.existsSync(base))
      return res.status(404).json({ error: "Gallery not found" });

    fs.rmSync(base, { recursive: true, force: true });

    const data = loadGalleries();
    data.users = data.users.filter(u => u.username !== req.params.user);
    saveGalleries(data);

    res.json({ success: true });
  } catch {
    res.status(500).json({ error: "Server error" });
  }
});

/* =========================================================
   UPLOAD MEDIA WITH VIDEO OPTIMIZATION
   ========================================================= */
app.post("/api/upload/:user", async (req, res) => {
  try {
    if (!req.files || !req.files.files)
      return res.status(400).json({ error: "No files uploaded" });

    const user = req.params.user;

    const base = path.join(__dirname, "public", "galleries", user);
    const mediaDir = path.join(base, "media");
    const galleryFile = path.join(base, "gallery.json");

    if (!fs.existsSync(galleryFile))
      return res.status(404).json({ error: "Gallery not found" });

    const gallery = JSON.parse(fs.readFileSync(galleryFile));

    const uploadList = Array.isArray(req.files.files)
      ? req.files.files
      : [req.files.files];

    const batch = Date.now();

    for (let i = 0; i < uploadList.length; i++) {
      const file = uploadList[i];

      const ext = path.extname(file.name).toLowerCase();
      const safeName = `${batch}_${i}${ext}`;
      const outPath = path.join(mediaDir, safeName);

      await file.mv(outPath);

      const isVideo = [".avi", ".mov", ".mp4", ".mkv"].includes(ext);

      gallery.items.push({
        stored: safeName,
        batch,
        seq: i,
        type: isVideo ? "video" : "image"
      });

      /* ========== VIDEO CONVERSION PIPELINE ========== */
      if (isVideo) {

        const mp4Name = `${batch}_${i}_web.mp4`;
        const mp4Path = path.join(mediaDir, mp4Name);

        await new Promise((resolve, reject) => {

          const cmd = `
            ffmpeg -i "${outPath}" \
            -vf "scale='min(1280,iw)':'-2'" \
            -c:v libx264 \
            -preset veryfast \
            -crf 28 \
            -b:v 1200k \
            -maxrate 1500k \
            -bufsize 2000k \
            -movflags +faststart \
            -c:a aac \
            -b:a 128k \
            "${mp4Path}"
          `;

          exec(cmd, (err) => {
            if (err) {
              console.error("FFMPEG ERROR:", err);
              return reject(err);
            }

            // delete original huge file
            fs.unlinkSync(outPath);

            // update to new mp4 name
            gallery.items[gallery.items.length - 1].stored = mp4Name;
            gallery.items[gallery.items.length - 1].type = "video";

            resolve();
          });
        });
      }
      /* =============================================== */
    }

    fs.writeFileSync(galleryFile, JSON.stringify(gallery, null, 2));

    res.json({ success: true });

  } catch (err) {
    console.error("❌ UPLOAD FAILED:", err);
    res.status(500).json({ error: "Upload failed" });
  }
});

/* =========================================================
   START SERVER
   ========================================================= */
app.listen(PORT, () =>
  console.log(`✅ SmallPhotos running on port ${PORT}`)
);
