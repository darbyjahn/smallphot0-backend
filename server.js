const express = require("express");
const fileUpload = require("express-fileupload");
const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");

const app = express();
const PORT = process.env.PORT || 3000;

/* =========================================================
   PATHS ON RENDER DISK
   ========================================================= */

const DATA_PATH = "/var/data";
const GALLERIES_PATH = path.join(DATA_PATH, "galleries");
const GALLERIES_FILE = path.join(DATA_PATH, "galleries.json");

/* ----- ENSURE DISK STRUCTURE ----- */
for (const p of [DATA_PATH, GALLERIES_PATH]) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

if (!fs.existsSync(GALLERIES_FILE)) {
  fs.writeFileSync(GALLERIES_FILE, JSON.stringify({ users: [] }, null, 2));
}

/* =========================================================
   MIDDLEWARE
   ========================================================= */

app.use(express.json());

app.use(
  fileUpload({
    useTempFiles: true,
    tempFileDir: "/tmp/",
    limits: { fileSize: 1024 * 1024 * 300 } // 300MB
  })
);

app.use(express.static("public"));
app.use("/galleries", express.static(GALLERIES_PATH));

/* =========================================================
   HELPERS
   ========================================================= */

const load = () => JSON.parse(fs.readFileSync(GALLERIES_FILE, "utf8"));
const save = d => fs.writeFileSync(GALLERIES_FILE, JSON.stringify(d, null, 2));

function ensureGallery(username, title, bg, text) {
  const base = path.join(GALLERIES_PATH, username);

  if (!fs.existsSync(base)) {
    fs.mkdirSync(path.join(base, "media"), { recursive: true });

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

  const data = load();
  if (!data.users.find(u => u.username === username)) {
    data.users.push({ username, title, bg, text });
    save(data);
  }
}

/* =========================================================
   VIDEO CONVERSION (LOW RAM SAFE)
   ========================================================= */

function convertVideo(user, filename) {
  const mediaDir = path.join(GALLERIES_PATH, user, "media");

  const input = path.join(mediaDir, filename);
  const output = path.join(
    mediaDir,
    filename.replace(/\.\w+$/, "_web.mp4")
  );

  const cmd =
    `ffmpeg -i "${input}" ` +
    `-vf "scale='min(1280,iw)':-2" ` +
    `-c:v libx264 -preset veryfast -crf 28 ` +
    `-b:v 1200k -movflags +faststart ` +
    `-c:a aac -b:a 128k "${output}"`;

  console.log("🎬 Converting:", filename);

  exec(cmd, (err) => {
    const gp = path.join(GALLERIES_PATH, user, "gallery.json");
    let g = JSON.parse(fs.readFileSync(gp));

    const item = g.items.find(i => i.stored === filename);
    if (!item) return;

    if (err) {
      console.error("❌ FFmpeg failed:", err);
      item.processing = "failed";
    } else {
      try { fs.unlinkSync(input); } catch {}

      item.stored = path.basename(output);
      item.processing = false;
      item.type = "video";

      console.log("✅ Video ready:", output);
    }

    fs.writeFileSync(gp, JSON.stringify(g, null, 2));
  });
}

/* =========================================================
   RULES
   ========================================================= */

const ALLOWED = [
  ".jpg",".jpeg",".png",".gif",".webp",
  ".mp4",".mov",".avi",".mkv"
];

const VIDEO_EXT = [".mp4",".mov",".avi",".mkv"];

/* =========================================================
   DELETE SINGLE ITEM (BETTER ERRORS)
   ========================================================= */

app.delete("/api/deleteItem/:user/:file", (req, res) => {
  try {
    const { user, file } = req.params;

    const fp = path.join(GALLERIES_PATH, user, "media", file);
    const gp = path.join(GALLERIES_PATH, user, "gallery.json");

    if (!fs.existsSync(gp))
      return res.status(404).json({ error: "Gallery not found" });

    if (!fs.existsSync(fp))
      return res.status(404).json({ error: "File not found on disk" });

    fs.unlinkSync(fp);

    let g = JSON.parse(fs.readFileSync(gp));
    g.items = g.items.filter(i => i.stored !== file);

    fs.writeFileSync(gp, JSON.stringify(g, null, 2));

    res.json({ success: true });

  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server could not delete item" });
  }
});

/* =========================================================
   REORDER (SAFE)
   ========================================================= */

app.post("/api/reorder/:user", (req, res) => {
  try {
    const gp = path.join(GALLERIES_PATH, req.params.user, "gallery.json");

    let g = JSON.parse(fs.readFileSync(gp));

    g.items = req.body.order
      .map((src, i) => {
        const name = src.replace("media/", "");
        const old = g.items.find(x => x.stored === name);
        return old ? { ...old, seq: i } : null;
      })
      .filter(Boolean);

    fs.writeFileSync(gp, JSON.stringify(g, null, 2));

    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: "Could not reorder" });
  }
});

/* =========================================================
   UPLOAD WITH RULES
   ========================================================= */

app.post("/api/upload/:user", async (req, res) => {
  try {
    const user = req.params.user;

    ensureGallery(user, user, "#fff", "#000");

    if (!req.files || !req.files.files)
      return res.status(400).json({ error: "No files received" });

    const files = Array.isArray(req.files.files)
      ? req.files.files
      : [req.files.files];

    /* ----- RULE: MAX 3 VIDEOS ----- */
    const videoCount = files.filter(f =>
      VIDEO_EXT.includes(path.extname(f.name).toLowerCase())
    ).length;

    if (videoCount > 3) {
      return res.status(400).json({
        error:
          "Too many videos at once. Please upload max 3 videos at a time — videos are heavy 💀"
      });
    }

    const dir = path.join(GALLERIES_PATH, user, "media");
    const gp = path.join(GALLERIES_PATH, user, "gallery.json");

    let g = JSON.parse(fs.readFileSync(gp));
    const batch = Date.now();

    for (let i = 0; i < files.length; i++) {
      const f = files[i];

      const ext = path.extname(f.name).toLowerCase();

      /* ----- WHITELIST ----- */
      if (!ALLOWED.includes(ext)) {
        return res.status(400).json({
          error: `File type ${ext} not allowed`
        });
      }

      const safe =
        Date.now() +
        "_" +
        Math.random().toString(36).slice(2) +
        ext;

      await f.mv(path.join(dir, safe));

      const isVideo = VIDEO_EXT.includes(ext);

      g.items.push({
        stored: safe,
        batch,
        seq: i,
        type: isVideo ? "video" : "image",
        processing: isVideo
      });

      if (isVideo) convertVideo(user, safe);
    }

    fs.writeFileSync(gp, JSON.stringify(g, null, 2));

    res.json({ success: true });

  } catch (err) {
    console.error("UPLOAD ERROR:", err);

    res.status(500).json({
      error:
        "Upload failed — if these were big videos try one at a time 🙏"
    });
  }
});

/* =========================================================
   BASIC
   ========================================================= */

app.get("/api/galleries", (req, res) =>
  res.json(load().users)
);

app.delete("/api/delete/:user", (req, res) => {
  try {
    fs.rmSync(
      path.join(GALLERIES_PATH, req.params.user),
      { recursive: true, force: true }
    );

    let d = load();
    d.users = d.users.filter(u => u.username !== req.params.user);
    save(d);

    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: "Could not delete gallery" });
  }
});

app.listen(PORT, () => console.log("🚀 server running"));
