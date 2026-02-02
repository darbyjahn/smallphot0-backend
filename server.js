const express = require("express");
const fileUpload = require("express-fileupload");
const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(fileUpload());

app.use(express.static(path.join(__dirname, "public")));
app.use("/galleries",
  express.static(path.join(__dirname, "public", "galleries"))
);

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

const saveGalleries = d =>
  fs.writeFileSync(GALLERIES_FILE, JSON.stringify(d, null, 2));

/* ===== ENSURE GALLERY ===== */

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
      JSON.stringify({
        title,
        bg_color: bg,
        text_color: text,
        items: []
      }, null, 2)
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

/* ===== LIST ===== */

app.get("/api/galleries", (req,res) => {
  res.json(loadGalleries().users);
});

/* ===== CREATE ===== */

app.post("/api/create", (req,res) => {

  const { username, title, bg, text } = req.body;

  if (!username || !title)
    return res.status(400).json({ error:"Missing fields" });

  ensureGalleryExists(username, title, bg, text);

  res.json({ success:true });
});

/* ===== DELETE ===== */

app.delete("/api/delete/:user", (req,res) => {

  const base =
    path.join(__dirname,"public","galleries",req.params.user);

  if (!fs.existsSync(base))
    return res.status(404).json({error:"Not found"});

  fs.rmSync(base,{recursive:true,force:true});

  const data = loadGalleries();
  data.users = data.users.filter(
    u => u.username !== req.params.user
  );
  saveGalleries(data);

  res.json({ success:true });
});

/* ===== UPLOAD SAFE APPEND ===== */

app.post("/api/upload/:user", async (req,res) => {

  try {

    if (!req.files)
      return res.status(400).json({error:"No files"});

    const user = req.params.user;

    ensureGalleryExists(user, user);

    const base =
      path.join(__dirname,"public","galleries",user);

    const mediaDir =
      path.join(base,"media");

    const galleryFile =
      path.join(base,"gallery.json");

    const uploadList =
      Array.isArray(req.files.files)
        ? req.files.files
        : [req.files.files];

    const batch = Date.now();

    for (let i=0;i<uploadList.length;i++) {

      // 👉 RELOAD EVERY LOOP = NO WIPE
      const gallery =
        JSON.parse(fs.readFileSync(galleryFile));

      const file = uploadList[i];
      const ext = path.extname(file.name).toLowerCase();

      const safeName = `${batch}_${i}${ext}`;
      const outPath = path.join(mediaDir,safeName);

      await file.mv(outPath);

      const isVideo =
        [".avi",".mov",".mp4",".mkv"].includes(ext);

      gallery.items.push({
        stored: safeName,
        batch,
        seq: i,
        type: isVideo ? "video" : "image"
      });

      /* ---- VIDEO CONVERT ---- */

      if (isVideo) {

        const mp4Name = `${batch}_${i}_web.mp4`;
        const mp4Path = path.join(mediaDir,mp4Name);

        await new Promise((ok,fail)=>{

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

          exec(cmd,err=>{
            if(err) return fail(err);

            fs.unlinkSync(outPath);

            const last =
              gallery.items[gallery.items.length-1];

            last.stored = mp4Name;
            last.type = "video";

            ok();
          });
        });
      }

      // 👉 WRITE AFTER EACH FILE
      fs.writeFileSync(
        galleryFile,
        JSON.stringify(gallery,null,2)
      );
    }

    res.json({success:true});

  } catch(err) {
    console.error(err);
    res.status(500).json({error:"Upload failed"});
  }
});

app.listen(PORT,()=>console.log("✅ running"));
