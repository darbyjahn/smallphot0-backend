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
app.use("/galleries",
  express.static(path.join(__dirname, "public", "galleries"))
);

/* ---------- ROOT ---------- */
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

/* ---------- DATA FILE ---------- */
const GALLERIES_FILE =
  path.join(__dirname, "galleries.json");

if (!fs.existsSync(GALLERIES_FILE)) {
  fs.writeFileSync(
    GALLERIES_FILE,
    JSON.stringify({ users: [] }, null, 2)
  );
}

const loadGalleries = () =>
  JSON.parse(fs.readFileSync(GALLERIES_FILE, "utf8"));

const saveGalleries = data =>
  fs.writeFileSync(
    GALLERIES_FILE,
    JSON.stringify(data, null, 2)
  );

/* =========================================================
   ENSURE GALLERY EXISTS + COLOR SUPPORT
   ========================================================= */

function ensureGalleryExists(
  username,
  title = username,
  bg = "#ffffff",
  text = "#000000"
) {

  const data = loadGalleries();

  const base =
    path.join(__dirname, "public", "galleries", username);

  const mediaDir =
    path.join(base, "media");

  if (!fs.existsSync(base)) {

    fs.mkdirSync(mediaDir, { recursive: true });

    fs.writeFileSync(
      path.join(base, "gallery.json"),
      JSON.stringify(
        {
          title,
          bg_color: bg,
          text_color: text,
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

  if (!data.users.find(u => u.username === username)) {
    data.users.push({ username, title, bg, text });
    saveGalleries(data);
  }
}

/* =========================================================
   CREATE GALLERY WITH COLORS
   ========================================================= */

app.post("/api/create", (req, res) => {

  try {

    const {
      username,
      title,
      bg_color,
      text_color
    } = req.body;

    if (!username || !title)
      return res.status(400)
        .json({ error: "Missing fields" });

    ensureGalleryExists(
      username,
      title,
      bg_color,
      text_color
    );

    res.json({ success: true });

  } catch (err) {

    console.error("❌ CREATE FAILED:", err);

    res.status(500)
      .json({ error: "Server error" });
  }
});

/* =========================================================
   SAFE GALLERY LOADER
   ========================================================= */

function loadGalleryFile(file) {

  try {
    return JSON.parse(fs.readFileSync(file));
  } catch {

    return {
      title: "Recovered Gallery",
      bg_color: "#ffffff",
      text_color: "#000000",
      items: []
    };
  }
}

/* =========================================================
   UPLOAD — APPEND ONLY + ATOMIC VIDEO
   ========================================================= */

app.post("/api/upload/:user", async (req, res) => {

  try {

    if (!req.files || !req.files.files)
      return res.status(400)
        .json({ error: "No files uploaded" });

    const user = req.params.user;

    ensureGalleryExists(user, user);

    const base =
      path.join(__dirname, "public", "galleries", user);

    const mediaDir =
      path.join(base, "media");

    const galleryFile =
      path.join(base, "gallery.json");

    const gallery =
      loadGalleryFile(galleryFile);

    const uploadList =
      Array.isArray(req.files.files)
        ? req.files.files
        : [req.files.files];

    const batch = Date.now();

    let seq = 0;

    for (let file of uploadList) {

      const ext =
        path.extname(file.name).toLowerCase();

      const tempName =
        `${batch}_${seq}_temp${ext}`;

      const finalName =
        `${batch}_${seq}${ext}`;

      const tempPath =
        path.join(mediaDir, tempName);

      const finalPath =
        path.join(mediaDir, finalName);

      await file.mv(tempPath);

      const isVideo =
        [".avi",".mov",".mp4",".mkv"]
          .includes(ext);

      /* ---------- VIDEO ---------- */

      if (isVideo) {

        const mp4Name =
          `${batch}_${seq}_web.mp4`;

        const mp4Path =
          path.join(mediaDir, mp4Name);

        await new Promise((resolve,reject)=>{

          const cmd = `
ffmpeg -i "${tempPath}" \
-vf "scale='min(1280,iw)':'-2'" \
-c:v libx264 -preset veryfast -crf 28 \
-b:v 1200k -movflags +faststart \
-c:a aac -b:a 128k \
"${mp4Path}"
`;

          exec(cmd,(err)=>{

            if (err) return reject(err);

            fs.unlinkSync(tempPath);

            gallery.items.push({
              stored: mp4Name,
              batch,
              seq,
              type: "video"
            });

            resolve();
          });
        });

      } else {

        fs.renameSync(tempPath, finalPath);

        gallery.items.push({
          stored: finalName,
          batch,
          seq,
          type: "image"
        });
      }

      seq++;
    }

    fs.writeFileSync(
      galleryFile,
      JSON.stringify(gallery, null, 2)
    );

    res.json({ success: true });

  } catch (err) {

    console.error("❌ UPLOAD FAILED:", err);

    res.status(500)
      .json({ error: "Upload failed" });
  }
});

/* ========================================================= */

app.listen(PORT, () =>
  console.log(`✅ SmallPhotos running on ${PORT}`)
);
