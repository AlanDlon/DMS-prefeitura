const http = require('http');
const fs = require('fs');

const server = http.createServer((req, res) => {
  if (req.url === '/api/ping') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', message: 'HTTP API is alive', time: new Date().toISOString() }));
  } else {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<html><body><h1>HTTP Server</h1><p>API is at /api/ping</p></body></html>');
  }
});

server.listen(3000, '0.0.0.0', () => {
  fs.writeFileSync('http-server.log', 'HTTP server started at ' + new Date().toISOString());
  console.log('HTTP server started on port 3000');
});
