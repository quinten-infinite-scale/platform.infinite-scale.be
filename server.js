const http = require('http');
const fs = require('fs');
const path = require('path');
const port = 5500;
const root = path.join(__dirname, 'public');
const mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
http.createServer((req, res) => {
  const urlPath = req.url.split('?')[0];
  let p = path.join(root, urlPath === '/' ? '/index.html' : urlPath);
  if (!p.startsWith(root)) { res.writeHead(403); return res.end(); }
  fs.readFile(p, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': mime[path.extname(p)] || 'text/plain' });
    res.end(data);
  });
}).listen(port, () => console.log('Serving on ' + port));
