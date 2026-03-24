import fs from "fs";
fs.writeFileSync("server-load.log", "SERVER.TS IS LOADING at " + new Date().toISOString());

import express from "express";
import multer from "multer";
import cors from "cors";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";

const PORT = 3000;

async function startServer() {
  try {
    const app = express();

    // Ensure uploads directory exists
    const uploadsDir = path.join(process.cwd(), "uploads");
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }

    // 1. Basic Middlewares
    app.use(cors());
    app.use(express.json({ limit: "50mb" }));
    app.use(express.urlencoded({ limit: "50mb", extended: true }));

    // 2. Request Logger
    const logFile = path.join(process.cwd(), "requests.log");
    app.use((req, res, next) => {
      const logEntry = `[${new Date().toISOString()}] ${req.method} ${req.url} (Headers: ${JSON.stringify(req.headers)})\n`;
      fs.appendFileSync(logFile, logEntry);
      console.log(logEntry);
      next();
    });

    // 3. Static Files
    app.use("/uploads", express.static(uploadsDir));

    // 4. API Routes (MUST be before Vite)
    app.get("/api/ping", (req, res) => {
      console.log("Ping request received");
      res.json({ 
        status: "ok", 
        message: "DMS API is active", 
        timestamp: new Date().toISOString(),
        env: process.env.NODE_ENV || "development"
      });
    });

    // Multer Config
    const storage = multer.diskStorage({
      destination: (req, file, cb) => cb(null, "uploads/"),
      filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
        cb(null, file.fieldname + "-" + uniqueSuffix + path.extname(file.originalname));
      }
    });

    const upload = multer({ 
      storage,
      limits: { fileSize: 50 * 1024 * 1024 }
    });

    app.post("/api/upload", (req, res) => {
      console.log("Upload request received");
      upload.single("pdf")(req, res, (err) => {
        if (err) {
          console.error("Upload Error:", err);
          return res.status(err instanceof multer.MulterError ? 400 : 500).json({ 
            error: err.message || "Erro no processamento do arquivo" 
          });
        }
        
        if (!req.file) {
          return res.status(400).json({ error: "Nenhum arquivo enviado." });
        }

        console.log(`File uploaded: ${req.file.filename}`);
        res.json({ 
          filePath: req.file.path,
          fileName: req.file.originalname,
          mimeType: req.file.mimetype
        });
      });
    });

    // ScanSnap Routes
    app.get("/api/scansnap/auth", (req, res) => {
      const clientId = process.env.SCANSNAP_CLIENT_ID || "PLACEHOLDER";
      const redirectUri = `${process.env.APP_URL || `http://localhost:${PORT}`}/api/scansnap/callback`;
      res.redirect(`https://cloud.scansnap.com/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=scan_data`);
    });

    app.get("/api/scansnap/callback", (req, res) => {
      res.send("<html><body><h2>Conectado!</h2><script>setTimeout(()=>window.close(),2000)</script></body></html>");
    });

    // 6. Start Listening (BEFORE Vite to avoid blocking)
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`\n>>> DMS Server is running on port ${PORT} <<<`);
      console.log(`>>> Health check: http://localhost:${PORT}/api/ping <<<\n`);
    });

    // 5. Vite or Static Production Files
    if (process.env.NODE_ENV === "production") {
      const distPath = path.join(process.cwd(), "dist");
      if (fs.existsSync(distPath)) {
        app.use(express.static(distPath));
        app.get("*", (req, res) => res.sendFile(path.join(distPath, "index.html")));
      } else {
        console.warn("Production mode but 'dist' folder not found. Falling back to dev mode.");
        const vite = await createViteServer({ server: { middlewareMode: true }, appType: "spa" });
        app.use(vite.middlewares);
      }
    } else {
      console.log("Initializing Vite middleware...");
      const vite = await createViteServer({ 
        server: { middlewareMode: true }, 
        appType: "spa",
        root: process.cwd()
      });
      app.use(vite.middlewares);
      console.log("Vite middleware ready.");
    }

  } catch (error: any) {
    const errorMsg = `FATAL ERROR [${new Date().toISOString()}]:\n${error.stack || error.message}`;
    fs.writeFileSync("server-error.log", errorMsg);
    console.error(errorMsg);
    process.exit(1);
  }
}

startServer();
