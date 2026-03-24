import express from "express";
import multer from "multer";
import cors from "cors";
import path from "path";
import fs from "fs";
import axios from "axios";
import { createServer as createViteServer } from "vite";

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());
app.use("/uploads", express.static("uploads"));

// Ensure uploads directory exists
if (!fs.existsSync("uploads")) {
  fs.mkdirSync("uploads");
}

// Configuração do Multer para upload de arquivos
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/");
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, file.fieldname + "-" + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ storage });

// 1. ENDPOINT DE UPLOAD
app.post("/api/upload", upload.single("pdf"), (req, res) => {
  const file = req.file;

  if (!file) {
    return res.status(400).json({ error: "Nenhum arquivo enviado." });
  }

  // Retorna o caminho do arquivo para que o frontend possa processar
  res.json({ 
    filePath: file.path,
    fileName: file.originalname,
    mimeType: file.mimetype
  });
});

// 2. SCANSNAP OAUTH & WEBHOOK
// Nota: Estes endpoints são para integração com ScanSnap Cloud API
app.get("/api/scansnap/auth", (req, res) => {
  const clientId = process.env.SCANSNAP_CLIENT_ID || "PLACEHOLDER_CLIENT_ID";
  const redirectUri = process.env.SCANSNAP_REDIRECT_URI || `${process.env.APP_URL}/api/scansnap/callback`;
  
  const authUrl = `https://cloud.scansnap.com/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=scan_data`;
  
  res.redirect(authUrl);
});

app.get("/api/scansnap/callback", async (req, res) => {
  const { code } = req.query;
  
  if (!code) {
    return res.status(400).send("Código de autorização não fornecido.");
  }

  try {
    // Em um cenário real, trocaríamos o código pelo token aqui
    // const response = await axios.post("https://cloud.scansnap.com/oauth/token", {
    //   client_id: process.env.SCANSNAP_CLIENT_ID,
    //   client_secret: process.env.SCANSNAP_CLIENT_SECRET,
    //   code,
    //   grant_type: "authorization_code",
    //   redirect_uri: process.env.SCANSNAP_REDIRECT_URI
    // });
    
    // Simulação de sucesso para demonstração
    res.send(`
      <html>
        <body style="font-family: sans-serif; text-align: center; padding-top: 50px;">
          <h2>ScanSnap Conectado com Sucesso!</h2>
          <p>Você já pode fechar esta janela e voltar para o aplicativo.</p>
          <script>
            setTimeout(() => window.close(), 3000);
          </script>
        </body>
      </html>
    `);
  } catch (error) {
    console.error("Erro no callback do ScanSnap:", error);
    res.status(500).send("Erro ao processar autenticação do ScanSnap.");
  }
});

// Webhook para receber arquivos do ScanSnap Cloud
app.post("/api/scansnap/webhook", upload.single("file"), (req, res) => {
  const file = req.file;
  
  if (!file) {
    return res.status(400).json({ error: "Nenhum arquivo recebido no webhook." });
  }

  console.log("Arquivo recebido via ScanSnap Webhook:", file.filename);
  
  // Aqui poderíamos notificar o frontend via WebSockets ou salvar no Firestore
  // Para este exemplo, apenas confirmamos o recebimento
  res.status(200).json({ status: "success", fileName: file.filename });
});

// Servir arquivos estáticos (Vite middleware)
async function startServer() {
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
    console.log(`DMS Server running on http://localhost:${PORT}`);
  });
}

startServer();
