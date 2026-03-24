import express from "express";
import fs from "fs";

const app = express();
const PORT = 3000;

app.get("/api/ping", (req, res) => {
  res.json({ status: "ok", message: "JS API is alive", time: new Date().toISOString() });
});

app.get("/", (req, res) => {
  res.send("<html><body><h1>JS Server</h1><p>API is at /api/ping</p></body></html>");
});

app.listen(PORT, "0.0.0.0", () => {
  fs.writeFileSync("js-server.log", "JS server started at " + new Date().toISOString());
  console.log("JS server started on port 3000");
});
