const fs = require('fs'); 
const net = require('net');
const fetch = require('node-fetch');
const faker = require('faker');
const https = require('https'); 
const url = require('url'); 
const HttpsProxyAgent = require('https-proxy-agent');

const options = require('minimist')(process.argv.slice(2));
const proxy = process.env.http_proxy || options.proxy;
const debug = options.debug || false;
const remoteTunnelServerUrl = options.remote || 'http://127.0.0.1:8080';
const localProcessAddress = options.address || '127.0.0.1';
const localProcessPort = options.port || 2222;
const retries = options.retries || 3;
const targetHost = options.targetHost || undefined;
const targetPort = options.targetPort || undefined;

const clientCaPath = options.caPath;
const clientCertPath = options.certPath;
const clientKeyPath = options.keyPath;

const AgentClass = !!proxy ? HttpsProxyAgent : https.Agent;

const proxyUrl = !!proxy ? url.parse(proxy): {};

const agent = (clientCaPath || clientCertPath || clientKeyPath) ? new AgentClass({
  ...proxyUrl,
  key: clientKeyPath ? fs.readFileSync(clientKeyPath) : undefined,
  cert: clientCertPath ? fs.readFileSync(clientCertPath) : undefined,
  ca: clientCaPath ? fs.readFileSync(clientCaPath) : undefined,
}) : undefined;

const sessions = {};

function debugLog(...args) {
  if (debug) {
    console.log(...args);
  }
}

function sendToServer(sessionId, data) {
  const payload = { sessionId, data: data.toString('base64') };
  debugLog(`Write bytes (${payload.data.length}) from session ${sessionId} on remote server.`)
  return fetch(`${remoteTunnelServerUrl}/sessions/${sessionId}`, {
    method: 'PUT',
    agent,
    headers: {
      'Content-Type': 'application/json',
      'Target-Host': targetHost,
      'Target-Port': targetPort,
    },
    body: JSON.stringify(payload)
  });
}

function readFromServer(sessionId) {
  return fetch(`${remoteTunnelServerUrl}/sessions/${sessionId}`, {
    method: 'GET',
    agent,
    headers: {
      'Accept': 'application/json',
      'Target-Host': targetHost,
      'Target-Port': targetPort,
    },
  }).then(r => r.json()).then(r => {
    if (r.data && r.data !== '') {
      const data = Buffer.from(r.data, 'base64');
      if (data.length > 0) {
        debugLog(`Read bytes (${data.length}) from session ${sessionId} on remote server.`);
        return data;
      } else {
        return null;
      }
    } else {
      return null;
    }
  })
}

function createSession(sessionId) {
  debugLog(`Create session ${sessionId} on remote server.`)
  return fetch(`${remoteTunnelServerUrl}/sessions/${sessionId}`, {
    method: 'POST',
    agent,
    headers: {
      'Content-Type': 'text/plain',
      'Accept': 'application/json',
      'Target-Host': targetHost,
      'Target-Port': targetPort,
    },
    body: ''
  });
}

function destroySession(sessionId) {
  debugLog(`Destroy session ${sessionId} on remote server.`)
  return fetch(`${remoteTunnelServerUrl}/sessions/${sessionId}`, {
    method: 'DELETE',
    agent,
    headers: {
      'Accept': 'application/json',
      'Target-Host': targetHost,
      'Target-Port': targetPort,
    }
  });
}

const server = net.createServer((socket) => {

  socket.setKeepAlive(true, 60000);

  const sessionId = faker.random.alphaNumeric(64);
  sessions[sessionId] = { sessionId };
  debugLog(`New client connected with session id: ${sessionId}`);
  createSession(sessionId);
  socket.on('end', () => {
    debugLog(`Client deconnected (end) from session ${sessionId}`);
    destroySession(sessionId);
    delete sessions[sessionId];
  });
  socket.on('close', () => {
    debugLog(`Client deconnected (close) from session ${sessionId}`);
    destroySession(sessionId);
    delete sessions[sessionId];
  });
  socket.on('error', (err) => {
    debugLog(`Client deconnected (error) from session ${sessionId}`, err);
    destroySession(sessionId);
    delete sessions[sessionId];
  });

  function readloop(count) {
    readFromServer(sessionId).then(payload => {
      if (payload) {
        if (payload.length > 0) {
          socket.write(payload);
        }
      }
      setTimeout(() => readloop(0), 0);
    }).catch(e => {
      console.log(`Error while fetching bytes for session ${sessionId}`, e);
      if (count < retries) {
        setTimeout(() => readloop(count + 1), 200);
      }
    });
  }

  readloop(0);

  socket.on('data', (data) => {
    sendToServer(sessionId, data);
  });
});

server.on('error', (err) => {
  console.log(`TCP Server error`, err);
});

server.listen(localProcessPort, localProcessAddress, () => {
  console.log(`Local tunnel client listening on tcp://${localProcessAddress}:${localProcessPort} and targeting ${remoteTunnelServerUrl}`);
});