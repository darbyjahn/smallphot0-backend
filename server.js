const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");

const app = express();
const PORT = process.env.PORT || 3000;

/* =========================================================
   PERSISTENT DISK PATHS
   ========================================================= */

const DATA_PATH = "/var/data";
const GALLERIES_PATH = path.join(DATA_PATH, "galleries");
const GALLERIES_FILE = path.join(DATA_PATH, "galleries.json");

/* ----- ENSURE DISK STRUCTURE ----- */
try {
  if (!fs.existsSync(DATA_PATH))
    fs.mkdirSync(DATA_PATH, { recursive: true });

  if (!fs.existsSync(GALLERIES_PATH))
    fs.mkdirSync(GALLERIES_PATH, { recursive: true });

  if (!fs.existsSync(GALLERIES_FILE))
    fs.writeFileSync(
      GALLERIES_FILE,
      JSON.stringify({ users: [] }, null, 2)
    );

} catch (e) {
  console.error("🚨 DISK NOT WRITABLE:", e);
}

/* =========================================================
   MULTER STREAMING UPLOAD (NO RAM BUFFER!)
   ========================================================= */

const storage = multer.diskStorage({

  destination: (req, file, cb) => {
    const dir = path.join(GALLERIES_PATH, req.params.user, "media");
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },

  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const safe =
      Date.now() +
      "_" +
      Math.random().toString(36).slice(2) +
      ext;

    cb(null, safe);
  }
});

const upload = multer({
  storage,

  limits: {
    fileSize: 1024 * 1024 * 300 // 300MB per file
  }
});

/* =========================================================
   MIDDLEWARE
   ========================================================= */

app.use(express.json());

app.use(express.static(path.join(__dirname, "public")));

/* 👉 SERVE FROM DISK */
app.use("/galleries", express.static(GALLERIES_PATH));

/* =========================================================
   HELPERS
   ========================================================= */

const loadGalleries = () =>
  JSON.parse(fs.readFileSync(GALLERIES_FILE, "utf8"));

const saveGalleries = (d) =>
  fs.writeFileSync(GALLERIES_FILE, JSON.stringify(d, null, 2));

function ensureGalleryExists(
  username,
  title = username,
  bg = "#ffffff",
  text = "#000000"
) {
  const data = loadGalleries();

  const base = path.join(GALLERIES_PATH, username);
  const mediaDir = path.join(base, "media");

  if (!fs.existsSync(base)) {

    fs.mkdirSync(mediaDir, { recursive: true });

    fs.writeFileSync(
      path.join(base, "gallery.json"),
      JSON.stringify(
        { title, bg_color: bg, text_color: text, items: [] },
        null,
        2
      )
    );

    fs.copyFileSync(
      path.join(__dirname, "public", "gallery.html"),
      path.join(base, "index.html")
    );
  }

  if (!data.users.find((u) => u.username === username)) {
    data.users.push({ username, title, bg, text });
    saveGalleries(data);
  }
}

/* =========================================================
   BACKGROUND VIDEO CONVERSION
   ========================================================= */

function convertVideoAsync(user, filename) {

  const mediaDir =
    path.join(GALLERIES_PATH, user, "media");

  const input = path.join(mediaDir, filename);

  const output = path.join(
    mediaDir,
    filename.replace(/\.\w+$/, "_web.mp4")
  );

  console.log("🎬 START CONVERT:", filename);

  const cmd =
    `ffmpeg -i "${input}" ` +
    `-vf "scale='min(1280,iw)':'-2'" ` +
    `-c:v libx264 -preset veryfast -crf 28 ` +
    `-b:v 1200k -movflags +faststart ` +
    `-c:a aac -b:a 128k "${output}"`;

  exec(cmd, (err) => {

    const galleryFile =
      path.join(GALLERIES_PATH, user, "gallery.json");

    let gallery =
      JSON.parse(fs.readFileSync(galleryFile));

    const item =
      gallery.items.find(i => i.stored === filename);

    if (!item) return;

    if (err) {
      console.error("❌ FFMPEG FAIL:", err);
      item.processing = "failed";

    } else {

      try {
        fs.unlinkSync(input);
      } catch {}

      item.stored = path.basename(output);
      item.processing = false;
      item.type = "video";

      console.log("✅ CONVERT DONE:", output);
    }

    fs.writeFileSync(
      galleryFile,
      JSON.stringify(gallery, null, 2)
    );
  });
}

/* =========================================================
   API
   ========================================================= */

app.get("/api/galleries", (req, res) => {
  res.json(loadGalleries().users);
});

app.post("/api/create", (req, res) => {

  const { username, title, bg, text } = req.body;

  if (!username || !title)
    return res.status(400).json({ error: "Missing fields" });

  ensureGalleryExists(username, title, bg, text);

  res.json({ success: true });
});

app.delete("/api/delete/:user", (req, res) => {

  const base = path.join(GALLERIES_PATH, req.params.user);

  if (!fs.existsSync(base))
    return res.status(404).json({ error: "Not found" });

  fs.rmSync(base, { recursive: true, force: true });

  const data = loadGalleries();

  data.users =
    data.users.filter(u => u.username !== req.params.user);

  saveGalleries(data);

  res.json({ success: true });
});

/* =========================================================
   UPLOAD – STREAM TO DISK FIRST
   ========================================================= */

app.post(
  "/api/upload/:user",
  upload.array("files"),
  async (req, res) => {

    try {

      const user = req.params.user;

      ensureGalleryExists(user, user);

      const base = path.join(GALLERIES_PATH, user);
      const galleryFile =
        path.join(base, "gallery.json");

      let gallery =
        JSON.parse(fs.readFileSync(galleryFile));

      const batch = Date.now();

      for (let i = 0; i < req.files.length; i++) {

        const file = req.files[i];
        const ext =
          path.extname(file.filename).toLowerCase();

        const isVideo =
          [".avi", ".mov", ".mp4", ".mkv"]
            .includes(ext);

        gallery.items.push({
          stored: file.filename,
          batch,
          seq: i,
          type: isVideo ? "video" : "image",
          processing: isVideo
        });

        if (isVideo)
          convertVideoAsync(user, file.filename);
      }

      fs.writeFileSync(
        galleryFile,
        JSON.stringify(gallery, null, 2)
      );

      res.json({ success: true });

    } catch (err) {
      console.error("❌ UPLOAD ERROR:", err);

      res.status(500)
        .json({ error: "Upload failed" });
    }
  }
);

/* =========================================================
   START
   ========================================================= */

app.listen(PORT, () =>
  console.log(`✅ SmallPhotos running on port ${PORT}`)
);
