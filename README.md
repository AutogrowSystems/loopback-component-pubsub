# LoopBack Component PubSub

A [LoopBack Framework](http://loopback.io) Component that provides publish events over WebSockets.

This module will provide publish/subscribe functionality for [LoopBack Framework](http://loopback.io) Models that implements the `PubSub Mixin`.

## Publish Subscribe

The publish/subscribe pattern allow clients to subscribe to specific events, listening for data streams a server publish everytime there are new changes.

![Publish Subscribe Pattern](https://blog.gopheracademy.com/postimages/plumbing-and-semantics/pub-sub.jpg)

## Installation

```sh
$ npm install --save loopback-component-pubsub
```

## Setup in your application

Update the  `server/component-config.json` as follows:

```json
{
  "loopback-component-explorer": {
    "mountPath": "/explorer"
  },
  "loopback-component-pubsub": {
    "auth": true
  }
}

```

Update the  `server/model-config.json` as follows:

```json
{
    "mixins": [
        "loopback/common/mixins",
        "loopback/server/mixins",
        "../common/mixins",
        "./mixins",
        "../node_modules/loopback-component-pubsub/mixins"
    ]
}
```

Update the start method within the `server/server.js` file as follows:

```js
app.start = function() {
  var server = app.listen(function() {
    app.emit('started', server);
    var baseUrl = app.get('url').replace(/\/$/, '');
    console.log('Web server listening at: %s', baseUrl);
    if (app.get('loopback-component-explorer')) {
      var explorerPath = app.get('loopback-component-explorer').mountPath;
      console.log('Browse your REST API at %s%s', baseUrl, explorerPath);
    }
  });

  // hack to tell pubsub that we are stopping
  server.closeServer = server.close;
  server.close = function(close) {
    app.emit("stopping");
    server.closeServer(close);
  };

  return server;
};
```

## Configure Models

Thanks to the provided mixin, you are able to define in which Models you want to make available the PubSub functionality by explicitly defining it in the model json file.

```json
{
  "mixins": {
    "PubSub": true
  }
}
```

This will push RSET based events out to the following:

* [POST]/accounts
* [PUT]/accounts/1

## Custom events

You can setup custom endpoint to push data out on like so:

```js

Account.observe("before save", (ctx, next) => {

  if ( ctx && ctx.data && ctx.data.login ) {
    Account.app.pubsub.publish({
      method: "put",
      endpoint: "/api/accounts/"+ctx.where.id+"/logins",
      data: ctx.data.login
    });
  }

  next();
});

```

## Subscribing to events

### Unauthenticated

You can subscribe to any valid remote method within your model as follows:

```html
<html>
<head>
  <title>Event Source Test</title>
  <script src="/socket.io/socket.io.js"></script>
  <script>
    var client = io('http://localhost:3000');
        // subscribe for newly created rooms
        client.on('[POST]/api/rooms', function (room) {
           console.info('Room ', room);
        });
        // subscribe for new messages in the room with Id 1
        client.on('[POST]/api/rooms/1/messages', function (message) {
           console.info('Message ', message);
        });
  </script>
</head>
<body></body>
</html>
```

### Authenticated

You can subscribe to any valid remote method within your model as follows:

```html
<html>
<head>
  <title>Event Source Test</title>
  <script src="/socket.io/socket.io.js"></script>
  <script>
    var client;
    // Ajax Request logic to login and to get a token [/POST]/api/users/login
    // Use whatever method works best for you when doing AJAX Requests
    userLogin(function onLogged(token) {
      client = io('http://localhost:3000');
      client.on('connect', function onConnect() {
        client.emit('authentication', token);
        client.on('unauthorized', function onUnauthorized(res) {
          console.error('Unauthenticated', res);
        });
      });
      // subscribe for newly created rooms
      client.on('[POST]/api/rooms', function (room) {
        console.info('Room ', room);
      });
      // subscribe for new messages in the room with Id 1
      client.on('[POST]/api/rooms/1/messages', function (message) {
        console.info('Message ', message);
      });
    });
  </script>
</head>
<body></body>
</html>
```

## Testing

### This library

Coming soon.

### Your API

Install `socket.io-client` first:

    $ npm install --save-dev socket.io-client

Then you write a test like so:

```js
describe("websockets", function() {
  var io = require("socket.io-client");

  it("should broadcast new accounts", (done) => {
    var client = io.connect("http://localhost:8000/");
    client.on("connect", () => {

      // subscribe for newly created accounts
      client.on("[POST]/accounts"), function (acct) {
        expect(acct).to.have.property("name");
        expect(acct.name).to.equal("frank");
        client.close(); // important for multiple WS tests or done() gets called > once
        done();
      });

      // trigger the WS event
      api.post("/accounts")
      .set("Accept", "application/json")
      .send({ name: "frank" })
      .expect(200)
      .end(() => {});

    });
  });

  it("should broadcast new logins", (done) => {
    var client = io.connect("http://localhost:8000/");
    client.on("connect", () => {

      var loginTime = Date.now()

      // subscribe for new logins
      client.on("[POST]/accounts/1/logins"), function (login) {
        expect(login).to.have.property("time");
        expect(login.time).to.equal(loginTime);
        client.close(); // important for multiple WS tests or done() gets called > once
        done();
      });

      // trigger the WS event
      api.post("/login")
      .set("Accept", "application/json")
      .send({ name: "frank", time: loginTime })
      .expect(200)
      .end(() => {});

    });

  });
});
```

## Debugging

You can get debug output from this library by setting `DEBUG="lc:pubsub"`
