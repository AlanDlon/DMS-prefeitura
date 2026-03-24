import fs from "fs";
import express from "express";
import multer from "multer";
import cors from "cors";
import path from "path";
import { createServer as createViteServer } from "vite";

const PORT = 3000;

async function startServer() {
  try {
    const app = express();

    // 1. Basic Middlewares
    app.use(cors());
    app.use(express.json({ limit: "50mb" }));
    app.use(express.urlencoded({ limit: "50mb", extended: true }));

    // 2. API Routes (MUST be before Vite)
    app.get("/api/ping", (req, res) => {
      res.json({ 
        status: "ok", 
        message: "DMS API is active", 
        timestamp: new Date().toISOString(),
        env: process.env.NODE_ENV || "development"
      });
    });

    // Ensure uploads directory exists
    const uploadsDir = path.join(process.cwd(), "uploads");
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }
    app.use("/uploads", express.static(uploadsDir));

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

    app.post("/api/upload", upload.single("pdf"), (req, res) => {
      if (!req.file) {
        return res.status(400).json({ error: "Nenhum arquivo enviado." });
      }
      res.json({ 
        filePath: `/uploads/${req.file.filename}`,
        fileName: req.file.originalname,
        mimeType: req.file.mimetype
      });
    });

    // 3. Start Listening (BEFORE Vite to avoid blocking)
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Server running on http://0.0.0.0:${PORT}`);
    });

    // 4. Vite or Static Production Files
    if (process.env.NODE_ENV === "production") {
      const distPath = path.join(process.cwd(), "dist");
      if (fs.existsSync(distPath)) {
        app.use(express.static(distPath));
        app.get("*", (req, res) => res.sendFile(path.join(distPath, "index.html")));
      } else {
        const vite = await createViteServer({ server: { middlewareMode: true }, appType: "spa" });
        app.use(vite.middlewares);
      }
    } else {
      const vite = await createViteServer({ 
        server: { middlewareMode: true }, 
        appType: "spa",
        root: process.cwd()
      });
      app.use(vite.middlewares);
    }

  } catch (error: any) {
    console.error("FATAL ERROR:", error);
    process.exit(1);
  }
}

startServer();
