# httptunnel

This is a poc of a httptunnel like tool written in node js. It can wrap any tcp protocol inside regular http GET / POST / PUT / DELETE calls.
Works with mTLS but oes not support http CONNECT proxy. Useful to use non http protocols (like ssh) through an http reverse proxy (like otoroshi).

For the following example let say we want to tunnel an ssh connection from machine A to machine B using only HTTP.

## On machine A (the client)

```sh
node src/client.js --remote 'http://xxx.xxx.xxx.xxx:8080' --port 2222
```

the client command supports the following options :

* debug: display debug logs
* remote: remote server url
* address: forwarded address, by default 127.0.0.1
* port: forwarded port, by default 2222
* retries: number of retries when http error occurs, by default 3
* caPath: path for a ca cert file
* certPath: path for a client cert file
* keyPath: path for a client cert key file

## On machine B (the server)

```sh
node src/client.js --port 8080 --targetPort 22
```

the server command supports the following options :

* debug: display debug logs
* port: http port, default is 8080;
* targetPort: target port, default is 22
* targetHost: target host, default is 127.0.0.1
* timeout: timeout in ms before releasing a read bytes connection, default is 10000;
* caPath: path for a ca cert file
* certPath: path for a client cert file
* keyPath: path for a client cert key file
* requestCert: request client cert
* rejectUnauthorized: reject non client cert requests

## Then on machine A again (the client)

```sh
ssh theuser@localhost -p 2222 # we use 2222 that is exposed by client.js
```
