const http = require('http');

const server = http.createServer((clientReq, clientRes) => {
  const options = {
    hostname: 'localhost',
    port: 3400,
    path: clientReq.url,
    method: clientReq.method,
    headers: { ...clientReq.headers, host: 'localhost:3400' },
  };

  const proxy = http.request(options, (res) => {
    const headers = { ...res.headers };
    delete headers['content-security-policy'];
    delete headers['x-frame-options'];
    clientRes.writeHead(res.statusCode, headers);
    res.pipe(clientRes, { end: true });
  });

  proxy.on('error', (err) => {
    clientRes.writeHead(502);
    clientRes.end(`Proxy error: ${err.message}`);
  });

  clientReq.pipe(proxy, { end: true });
});

server.listen(3401, '0.0.0.0', () => {
  console.log('CSP proxy running on port 3401 -> 3400');
});
