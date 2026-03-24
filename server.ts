import express from "express";
import multer from "multer";
import cors from "cors";
import path from "path";
import fs from "fs";
import axios from "axios";
import { createServer as createViteServer } from "vite";

// Servir arquivos estáticos (Vite middleware)
async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(cors());
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  
  // Request logger
  app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
  });

  app.use("/uploads", express.static(path.join(process.cwd(), "uploads")));

  // Ensure uploads directory exists
  const uploadsDir = path.join(process.cwd(), "uploads");
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }

  // Configuração do Multer
  const storage = multer.diskStorage({
    destination: (req, file, cb) => {
      cb(null, "uploads/");
    },
    filename: (req, file, cb) => {
      const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
      cb(null, file.fieldname + "-" + uniqueSuffix + path.extname(file.originalname));
    }
  });

  const upload = multer({ 
    storage,
    limits: { fileSize: 50 * 1024 * 1024 }
  });

  // API Routes
  app.get("/api/ping", (req, res) => {
    res.json({ status: "ok", message: "DMS API is alive", timestamp: new Date().toISOString() });
  });

  app.post("/api/upload", (req, res) => {
    console.log("Recebendo requisição de upload...");
    upload.single("pdf")(req, res, (err) => {
      if (err instanceof multer.MulterError) {
        console.error("Multer Error:", err);
        return res.status(400).json({ error: `Erro no upload (Multer): ${err.message}` });
      } else if (err) {
        console.error("Unknown Upload Error:", err);
        return res.status(500).json({ error: `Erro interno no servidor: ${err.message}` });
      }
      
      const file = req.file;
      if (!file) {
        return res.status(400).json({ error: "Nenhum arquivo enviado." });
      }

      console.log(`Upload concluído: ${file.filename}`);
      res.json({ 
        filePath: file.path,
        fileName: file.originalname,
        mimeType: file.mimetype
      });
    });
  });

  // ScanSnap Routes
  app.get("/api/scansnap/auth", (req, res) => {
    const clientId = process.env.SCANSNAP_CLIENT_ID || "PLACEHOLDER_CLIENT_ID";
    const redirectUri = process.env.SCANSNAP_REDIRECT_URI || `${process.env.APP_URL}/api/scansnap/callback`;
    const authUrl = `https://cloud.scansnap.com/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=scan_data`;
    res.redirect(authUrl);
  });

  app.get("/api/scansnap/callback", async (req, res) => {
    res.send("<html><body><h2>ScanSnap Conectado!</h2><script>setTimeout(() => window.close(), 3000);</script></body></html>");
  });

  app.post("/api/scansnap/webhook", upload.single("file"), (req, res) => {
    res.status(200).json({ status: "success", fileName: req.file?.filename });
  });

  // Catch-all for API routes to debug 404s
  app.all("/api/*", (req, res) => {
    console.warn(`[404] API Route not found: ${req.method} ${req.originalUrl}`);
    res.status(404).json({ 
      error: "API Route not found", 
      method: req.method, 
      path: req.originalUrl 
    });
  });

  // Vite middleware
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[${new Date().toISOString()}] DMS Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
