const express = require('express');
const fs = require('fs');

const app = express();
const PORT = 3000;

app.get('/api/ping', (req, res) => {
  res.json({ status: 'ok', message: 'CJS JS API is alive', time: new Date().toISOString() });
});

app.get('/', (req, res) => {
  res.send('<html><body><h1>CJS Server</h1><p>API is at /api/ping</p></body></html>');
});

app.listen(PORT, '0.0.0.0', () => {
  fs.writeFileSync('cjs-server.log', 'CJS server started at ' + new Date().toISOString());
  console.log('CJS server started on port 3000');
});
