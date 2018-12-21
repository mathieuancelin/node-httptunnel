const express = require('express');
const bodyParser = require('body-parser');
const net = require('net');

const fs = require('fs'); 
const http = require('http');
const https = require('https');

const app = express();
app.use(bodyParser.json(), bodyParser.text());

const options = require('minimist')(process.argv.slice(2));
const debug = options.debug || false;
const port = options.serverPort || 8080;
const fport = options.targetPort || 22;
const fhost = options.targetHost || '127.0.0.1';
const timeout = options.timeout || 10000;
const requestCert = options.requestCert || false;
const rejectUnauthorized = options.rejectUnauthorized || false;

const clientCaPath = options.caPath;
const clientCertPath = options.certPath;
const clientKeyPath = options.keyPath;

const httpsOptions = { 
  key: clientKeyPath ? fs.readFileSync(clientKeyPath) : undefined,
  cert: clientCertPath ? fs.readFileSync(clientCertPath) : undefined,
  ca: clientCaPath ? fs.readFileSync(clientCaPath) : undefined,
  requestCert: requestCert, 
  rejectUnauthorized: rejectUnauthorized
}; 

const sessions = {};

const server = (clientCaPath || clientCertPath || clientKeyPath) ? https.createServer(httpsOptions, app) : http.createServer(app);

function debugLog(...args) {
  if (debug) {
    console.log(...args);
  }
}

function _createSession(sessionId, req) {
  
  debugLog('Create session', sessionId);

  const client = new net.Socket();

  const targetHost = req.get('Target-Host');
  const targetPort = req.get('Target-Port');
  if (targetHost && targetPort && targetHost !== 'undefined' && targetPort !== 'undefined') {
    client.connect(parseInt(targetPort, 10), targetHost, () => {
      debugLog('Connected to', targetHost, targetPort);
    });
  } else {
    client.connect(fport, fhost, () => {
      debugLog('Connected to', fhost, fport);
    });
  }

  const session = {
    data: null,
    client
  };

  sessions[sessionId] = session;

  client.setKeepAlive(true, 60000);

  client.on('data', (data) => {
    if (session.data) {
      session.data = Buffer.concat([session.data, data], session.data.length + data.length)
    } else {
      session.data = data;
    }
  });
  
  client.on('close', () => {
    debugLog('Connection closed');
    client.destroy();
    delete sessions[sessionId];
  });

  client.on('error', (err) => {
    debugLog('Connection error', err);
    client.destroy();
    delete sessions[sessionId];
  });

  return session;
}

function _sendToSession(sessionId, dataIn) {
  const session = sessions[sessionId];
  if (session) {
    const buffer = Buffer.from(dataIn, 'base64');
    debugLog(`Writing ${buffer.length} bytes to session ${sessionId}`)
    session.client.write(buffer);
  } else {
    debugLog(`No session with id: ${sessionId}`)
  }
}

function _destroySession(sessionId) {
  debugLog('Destroy session', sessionId);
  const session = sessions[sessionId];
  if (session) {
    session.client.end();
  }
  delete sessions[sessionId];
}

/////////////////////////

function writeToSession(req, res) {
  const sessionId = req.params.id;
  const data = req.body;
  _sendToSession(sessionId, data);
  res.send({ done: true });
}

function createSession(req, res) {
  const sessionId = req.params.id;
  _createSession(sessionId, req);
  res.send({ done: true });
}

function destroySession(req, res) {
  const sessionId = req.params.id;
  _destroySession(sessionId);
  res.send({ done: true });
}

function readLastResponseFromSession(req, res) {
  
  const sessionId = req.params.id;
  let sent = false;

  function readFromSession() {
    const session = sessions[sessionId];
    if (session) {
      const data = session.data;
      if (data && !sent) {
        const buffer = data.toString('base64')
        debugLog(`Reading ${buffer.length} bytes from session ${sessionId}`)
        res.status(200).type('text').send(buffer);
        session.data = null;
        sent = true;
      } else {
        setTimeout(readFromSession, 100);
      }
    }
  }
  readFromSession();
  setTimeout(() => {
    if (!sent) {
      sent = true;
      res.send({ data: Buffer.from('').toString('base64') });
    }
  }, timeout);  
}

app.get('/sessions/:id', readLastResponseFromSession);
app.post('/sessions/:id', createSession);
app.delete('/sessions/:id', destroySession);
app.put('/sessions/:id', writeToSession);

server.listen(port, () => {
  const proto = (clientCaPath || clientCertPath || clientKeyPath) ? 'https' : 'http';
  console.log(`Tunnel server listening on ${proto}://0.0.0.0:${port}, forwarding to tcp://${fhost}:${fport}`);
});