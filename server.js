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
   LIST GALLERIES → HOMEPAGE USES THIS
   ========================================================= */
app.get("/api/galleries", (req, res) => {
  try {
    res.json(loadGalleries().users);
  } catch {
    res.status(500).json({ error: "Server error" });
  }
});



/* =========================================================
   CREATE GALLERY (MANUAL)
   ========================================================= */
function ensureGalleryExists(username, title = username) {

  const data = loadGalleries();

  const base = path.join(__dirname, "public", "galleries", username);
  const mediaDir = path.join(base, "media");

  if (!fs.existsSync(base)) {
    fs.mkdirSync(mediaDir, { recursive: true });

    fs.writeFileSync(
      path.join(base, "gallery.json"),
      JSON.stringify(
        {
          title: title,
          bg_color: "#ffffff",
          text_color: "#000000",
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
  }

  // 👉 CRITICAL PART — add to main list if missing
  if (!data.users.find(u => u.username === username)) {
    data.users.push({ username, title });
    saveGalleries(data);
  }
}



app.post("/api/create", (req, res) => {
  try {
    const { username, title } = req.body;

    if (!username || !title)
      return res.status(400).json({ error: "Missing fields" });

    ensureGalleryExists(username, title);

    res.json({ success: true });

  } catch (err) {
    console.error("❌ CREATE FAILED:", err);
    res.status(500).json({ error: "Server error" });
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
   UPLOAD MEDIA WITH AUTO-CREATE + VIDEO CONVERT
   ========================================================= */
app.post("/api/upload/:user", async (req, res) => {
  try {

    if (!req.files || !req.files.files)
      return res.status(400).json({ error: "No files uploaded" });

    const user = req.params.user;

    // 👉 THIS FIXES YOUR HOMEPAGE PROBLEM
    ensureGalleryExists(user, user);

    const base = path.join(__dirname, "public", "galleries", user);
    const mediaDir = path.join(base, "media");
    const galleryFile = path.join(base, "gallery.json");

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



      /* ========== VIDEO CONVERSION ========== */
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
            -movflags +faststart \
            -c:a aac \
            -b:a 128k \
            "${mp4Path}"
          `;

          exec(cmd, (err) => {
            if (err) return reject(err);

            fs.unlinkSync(outPath);

            gallery.items[gallery.items.length - 1].stored = mp4Name;
            gallery.items[gallery.items.length - 1].type = "video";

            resolve();
          });
        });
      }
    }



    fs.writeFileSync(galleryFile, JSON.stringify(gallery, null, 2));

    res.json({ success: true });

  } catch (err) {
    console.error("❌ UPLOAD FAILED:", err);
    res.status(500).json({ error: "Upload failed" });
  }
});



app.listen(PORT, () =>
  console.log(`✅ SmallPhotos running on port ${PORT}`)
);
