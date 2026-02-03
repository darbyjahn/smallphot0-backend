const express = require("express");
const fileUpload = require("express-fileupload");
const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");

const app = express();
const PORT = process.env.PORT || 3000;

const DATA_PATH = "/var/data";
const GALLERIES_PATH = path.join(DATA_PATH, "galleries");
const GALLERIES_FILE = path.join(DATA_PATH, "galleries.json");

/* DISK SETUP */
if (!fs.existsSync(DATA_PATH))
  fs.mkdirSync(DATA_PATH,{recursive:true});

if (!fs.existsSync(GALLERIES_PATH))
  fs.mkdirSync(GALLERIES_PATH,{recursive:true});

if (!fs.existsSync(GALLERIES_FILE))
  fs.writeFileSync(GALLERIES_FILE,'{"users":[]}');

app.use(express.json());

app.use(fileUpload({
  useTempFiles:true,
  tempFileDir:"/tmp/",
  limits:{fileSize:1024*1024*300}
}));

app.use(express.static("public"));
app.use("/galleries",express.static(GALLERIES_PATH));

const load=()=>JSON.parse(fs.readFileSync(GALLERIES_FILE));
const save=d=>fs.writeFileSync(GALLERIES_FILE,JSON.stringify(d,null,2));

function ensureGallery(username,title,bg,text){
  const base=path.join(GALLERIES_PATH,username);

  if(!fs.existsSync(base)){
    fs.mkdirSync(path.join(base,"media"),{recursive:true});

    fs.writeFileSync(
      path.join(base,"gallery.json"),
      JSON.stringify({
        title,bg_color:bg,text_color:text,items:[]
      },null,2)
    );

    fs.copyFileSync(
      path.join(__dirname,"public","gallery.html"),
      path.join(base,"index.html")
    );
  }

  const data=load();
  if(!data.users.find(u=>u.username===username)){
    data.users.push({username,title,bg,text});
    save(data);
  }
}

/* DELETE ITEM */
app.delete("/api/deleteItem/:user/:file",(req,res)=>{
  try{
    const {user,file}=req.params;

    const fp=path.join(GALLERIES_PATH,user,"media",file);
    const gp=path.join(GALLERIES_PATH,user,"gallery.json");

    if(fs.existsSync(fp)) fs.unlinkSync(fp);

    let g=JSON.parse(fs.readFileSync(gp));

    g.items=g.items.filter(i=>i.stored!==file);

    fs.writeFileSync(gp,JSON.stringify(g,null,2));

    res.json({success:true});
  }catch(e){
    res.status(500).json({error:"delete failed"});
  }
});

/* REORDER */
app.post("/api/reorder/:user",(req,res)=>{
  const gp=path.join(
    GALLERIES_PATH,
    req.params.user,
    "gallery.json"
  );

  let g=JSON.parse(fs.readFileSync(gp));

  g.items=req.body.order.map((src,i)=>{
    const name=src.replace("media/","");
    const old=g.items.find(x=>x.stored===name);
    return {...old,seq:i};
  });

  fs.writeFileSync(gp,JSON.stringify(g,null,2));

  res.json({success:true});
});

/* UPLOAD */
app.post("/api/upload/:user",async(req,res)=>{
  const user=req.params.user;

  ensureGallery(user,user,"#fff","#000");

  const files=Array.isArray(req.files.files)
    ? req.files.files
    : [req.files.files];

  const dir=path.join(GALLERIES_PATH,user,"media");
  const gp=path.join(GALLERIES_PATH,user,"gallery.json");

  let g=JSON.parse(fs.readFileSync(gp));

  const batch=Date.now();

  for(let i=0;i<files.length;i++){
    const f=files[i];

    const ext=path.extname(f.name);

    const safe=
      Date.now()+"_"+Math.random().toString(36).slice(2)+ext;

    await f.mv(path.join(dir,safe));

    g.items.push({
      stored:safe,
      batch,
      seq:i,
      type:[".mp4",".mov",".avi",".mkv"]
        .includes(ext.toLowerCase())
        ?"video":"image"
    });
  }

  fs.writeFileSync(gp,JSON.stringify(g,null,2));

  res.json({success:true});
});

/* BASIC */
app.get("/api/galleries",(req,res)=>
  res.json(load().users)
);

app.delete("/api/delete/:user",(req,res)=>{
  fs.rmSync(path.join(GALLERIES_PATH,req.params.user),{
    recursive:true,force:true
  });

  let d=load();
  d.users=d.users.filter(u=>u.username!==req.params.user);
  save(d);

  res.json({success:true});
});

app.listen(PORT,()=>console.log("running"));
