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
    limits: { fileSize: 1024 * 1024 * 150 }
  })
);

app.use(express.static("public"));
app.use("/galleries", express.static(GALLERIES_PATH));

/* 👉 ONLY NEW SECTION — FIX VIDEO MIME + SERVING */
app.use("/media", express.static(GALLERIES_PATH, {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith(".mp4")) res.set("Content-Type", "video/mp4");
    if (filePath.endsWith(".mov")) res.set("Content-Type", "video/mp4");
    if (filePath.endsWith(".webm")) res.set("Content-Type", "video/webm");
    if (filePath.endsWith(".jpg")) res.set("Content-Type", "image/jpeg");
    if (filePath.endsWith(".png")) res.set("Content-Type", "image/png");
  }
}));

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
   CREATE GALLERY
   ========================================================= */

app.post("/api/create", (req, res) => {

  const { username, title, bg, text } = req.body;

  if (!username || !title) {
    return res.status(400).json({ error: "Missing fields" });
  }

  try {
    ensureGallery(
      username,
      title,
      bg || "#ffffff",
      text || "#000000"
    );

    res.json({ success: true });

  } catch (e) {
    console.error("CREATE ERROR:", e);
    res.status(500).json({ error: "Could not create gallery" });
  }
});

/* =========================================================
   DELETE ITEM
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
   REORDER + ROTATION
   ========================================================= */

app.post("/api/reorder/:user", (req, res) => {
  try {
    const gp = path.join(GALLERIES_PATH, req.params.user, "gallery.json");

    let g = JSON.parse(fs.readFileSync(gp));

    // req.body.order is now expected to be an array of { src: "filename.jpg", rotation: 90 }
    g.items = req.body.order
      .map((item, i) => {
        const old = g.items.find(x => x.stored === item.src);
        return old ? { ...old, seq: i, rotation: item.rotation || 0 } : null;
      })
      .filter(Boolean);

    fs.writeFileSync(gp, JSON.stringify(g, null, 2));

    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not save" });
  }
});


app.post("/api/upload/:user", async (req, res) => {
  try {
    const user = req.params.user;

    ensureGallery(user, user, "#fff", "#000");

    if (!req.files || !req.files.files)
      return res.status(400).json({ error: "No files received" });

    const files = Array.isArray(req.files.files)
      ? req.files.files
      : [req.files.files];

    const dir = path.join(GALLERIES_PATH, user, "media");
    const gp = path.join(GALLERIES_PATH, user, "gallery.json");

    let g = JSON.parse(fs.readFileSync(gp));
    const batch = Date.now();

    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const ext = path.extname(f.name).toLowerCase();

      const safeBase =
        Date.now() + "_" + Math.random().toString(36).slice(2);

      let storedName = safeBase + ext;

      // Move uploaded file to user folder
      await f.mv(path.join(dir, storedName));

      // Re-encode video if needed
      if ([".mov", ".avi", ".mkv", ".mp4"].includes(ext)) {
        const converted = safeBase + ".mp4";

        await new Promise((resolve, reject) => {
          exec(
            `ffmpeg -y -i "${path.join(dir, storedName)}" -c:v libx264 -preset ultrafast -crf 32 -c:a aac -b:a 96k -movflags +faststart "${path.join(dir, converted)}"`,
            (err, stdout, stderr) => {
              if (err) {
                console.error("FFMPEG ERROR:", stderr);
                reject(err);
              } else {
                resolve();
              }
            }
          );
        });

        fs.unlinkSync(path.join(dir, storedName));
        storedName = converted;
      }

      g.items.push({
        stored: storedName,
        batch,
        seq: i,
        type: [".mp4", ".mov", ".avi", ".mkv"].includes(ext) ? "video" : "image",
      });
    }

    fs.writeFileSync(gp, JSON.stringify(g, null, 2));

    res.json({ success: true });
  } catch (err) {
    console.error("UPLOAD ERROR:", err);
    res.status(500).json({
      error: "Upload failed, try one video at a time",
    });
  }
});


/* =========================================================
   BASIC
   ========================================================= */

app.get("/api/galleries", (req, res) =>
  res.json(load().users)
);

/* =========================================================
   SET PIN FOR GALLERY
   ========================================================= */

app.post("/api/setPin/:user", (req, res) => {
  try {
    const user = req.params.user;
    const { pin } = req.body;

    if (!pin || !/^[0-9A-Za-z]{4}$/.test(pin)) {
      return res.status(400).json({ error: "Invalid PIN format" });
    }

    const gp = path.join(GALLERIES_PATH, user, "gallery.json");

    if (!fs.existsSync(gp)) {
      return res.status(404).json({ error: "Gallery not found" });
    }

    let g = JSON.parse(fs.readFileSync(gp, "utf8"));

    g.pin = pin;

    fs.writeFileSync(gp, JSON.stringify(g, null, 2));

    res.json({ success: true });

  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not set pin" });
  }
});

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
