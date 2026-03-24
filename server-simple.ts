import express from "express";
import fs from "fs";
import path from "path";

const app = express();
const PORT = 3000;

app.get("/api/ping", (req, res) => {
  res.json({ status: "ok", message: "Simple API is alive", time: new Date().toISOString() });
});

// Serve a dummy index.html for the root
app.get("/", (req, res) => {
  res.send("<html><body><h1>Simple Server</h1><p>API is at /api/ping</p></body></html>");
});

app.listen(PORT, "0.0.0.0", () => {
  fs.writeFileSync("simple-server.log", "Simple server started at " + new Date().toISOString());
  console.log("Simple server started on port 3000");
});
