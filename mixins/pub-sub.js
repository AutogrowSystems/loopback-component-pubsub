"use strict";

var async = require("async");
var debug = require("debug")("lc:pubsub");

var shouldIgnoreRequest = function(ctx) {
  return ctx.req.method === "GET" ||
    ctx.req.method === "HEAD" ||
    ctx.req.originalUrl.match(/resetPassword/g) ||
    ctx.req.originalUrl.match(/log(in|out)/g);
};

/**
 * @module LoopBack Component PubSub - Mixin -
 * @author Jonathan Casarrubias <@johncasarrubias>
 * @description
 *
 * The following algorithm will send messages to subscribed clients
 * for specific endpoints.
 *
 * If the request is in order to create a relationship between 2
 * entities, then the messages will be sent forwards and backwards
 *
 * Which means, that if you link an Account <-> Room 2 messages will
 * be sent:
 *
 *  1.- account.onRoomLink(account.id).subscribe(newRooms => {})
 *  2.- room.onAccountLink(room.id).subscribe(newAccount => {})
 *
 * Otherwise will send a direct message.
 *
 * Also it accepts filters defined within the model config, so you can
 * include data to messages sent, example:
 *
 *  When sending a message, we may want to include the owner account.
 */
module.exports = function (Model, options) {

  options = Object.assign({ filters: {} }, options);

  Model.beforeRemote("**", function(ctx, remoteMethodOutput, next) {

    // look at delete requests to send the data for the deleted instances with
    // with the request response.  Data is passed to the afterRemote hook via
    // hookState in the context, as with remote methods.
    if ( ctx && ctx.req.method == "DELETE" ) {
      ctx.hookState = {};

      // detect a relation being deleted
      if (ctx.methodString.match(/__(destroy)__/g)) {

        // we want to get the relations data, and we know the destroy method, so
        // just replace destroy with get and we can get that data.
        var getterMethod = ctx.method.name.replace("__destroy__", "__get__");
        if ( typeof ctx.instance[getterMethod] !== "function" ) {
          debug("cannot get doomed instance, %s does not have a method %s", ctx.instance.constructor.modelName, getterMethod);
        }

        // put the doomed relations data into the hookstate
        ctx.instance[getterMethod](function(err, doomedRelation){
          ctx.hookState.destroyed_data = doomedRelation;
          return next && next();
        });

      } else {
        ctx.hookState.destroyed_data = ctx.instance;
        return next && next();
      }

    } else {
      return next && next();
    }
  });

  Model.afterRemote("**", (ctx, remoteMethodOutput, next) => {
    if (shouldIgnoreRequest(ctx)) return next();

    // If the message event is due link relationships
    if (ctx.methodString.match(/__(link|unlink)__/g)) {
      let segments   = ctx.methodString.replace(/__[a-zA-Z]+__/g, "").split(".");
      let original   = ctx.req.originalUrl.split("/"); original.pop();
      original       = original.join("/");
      let current    = segments.shift();
      let related    = segments.pop().split("");
      related[0]     = related[0].toUpperCase(); related.pop();
      related        = related.join("");
      let inverse    = ctx.req.originalUrl.split("/"); inverse.shift();

      // Send Forward and Backward Messages in Parallel
      async.parallel([

        // Send Forward Message
        next => Model.app.models[related].findOne(
            Object.assign({
              where: {[ Model.app.models[related].getIdName() ]: ctx.req.params.fk }
            },
            (options.filters[ctx.method.name] && options.filters[ctx.method.name].forFK) ?
            options.filters[ctx.method.name].forFK : {}
        ), (err, res) => {
          if (err) return next(err);
          debug("sending forward message: relation link/unlink");

          Model.app.pubsub.publish({
            method   : ctx.req.method,
            endpoint : original,
            data     : res
          }, next);
        }),

        // Send Backward Message
        next => Model.app.models[current].findOne(
            Object.assign({
              where: {[ Model.app.models[current].getIdName() ]: ctx.req.params[[ Model.app.models[current].getIdName() ]] }
            },
            (options.filters[ctx.method.name] && options.filters[ctx.method.name].forPK) ?
            options.filters[ctx.method.name].forPK : {}
        ), (err, res) => {
          if (err) return next(err);
          debug("sending backward message: relation link/unlink");

          Model.app.pubsub.publish({
            method   : ctx.req.method,
            endpoint : "/" + [inverse[0], inverse[3], ctx.req.params.fk, inverse[1], inverse[4]].join("/"),
            data     : res
          }, next);
        })
      ], next);

    // Send Direct Message on Create Relation (not linking)
    } else if (ctx.methodString.match(/__(create)__/g)) {

      let segments   = ctx.methodString.replace(/__[a-zA-Z]+__/g, "").split(".");
      let current    = segments.shift();

      if (options.filters[ctx.method.name]) {
        debug("sending direct message: create relation with filters", ctx.method.name, options.filters[ctx.method.name]);

        let method     = Array.isArray(remoteMethodOutput) ? "find" : "findOne";

        let related    = segments.pop().split("");
        related[0]     = related[0].toUpperCase(); related.pop();
        related        = related.join("");

        let query      = Object.assign({
          where: {
            [ Model.app.models[related].getIdName() ]: remoteMethodOutput[ Model.app.models[related].getIdName() ]
          }
        }, options.filters[ctx.method.name]);

        Model.app.models[related][method](query, (err, instance) => {
          if (err) return next(err);
          if (!instance) {
            next();
            return debug("PUBSUB ERROR: Invalid Model Filters", options.filters[ctx.method.name]);
          }

          Model.app.pubsub.publish({
            method   : ctx.req.method,
            endpoint : ctx.req.originalUrl,
            data     : instance
          }, next);
        });
      } else {

        debug("sending direct message: create relation, no filters");

       // Send Direct Message without filters
        Model.app.pubsub.publish({
          method: ctx.req.method,
          endpoint: ctx.req.originalUrl,
          data: remoteMethodOutput
        }, next);

      }

    // Send Direct Message on deletion
    } else if (ctx.req.method === "DELETE" && ctx.hookState && ctx.hookState.destroyed_data ) {

      debug("sending direct message for destroyed model");
      Model.app.pubsub.publish({
        method   : ctx.req.method,
        endpoint : ctx.req.originalUrl,
        data     : ctx.hookState.destroyed_data
      }, next);

    // Send Direct Message no Relation
    } else {

      if (options.filters[ctx.method.name]) {
        // Send Direct Message with filters
        let method = Array.isArray(remoteMethodOutput) ? "find" : "findOne";
        Model[method](Object.assign(
          { where: remoteMethodOutput },
          options.filters[ctx.method.name]),
          (err, instance) => {
            if (err) return next(err);

            if (!instance) {
              next();
              return debug("PUBSUB ERROR: Invalid Model Filters", options.filters[ctx.method.name]);
            }

            debug("sending direct message: no relation");

            Model.app.pubsub.publish({
              method   : ctx.req.method,
              endpoint : ctx.req.originalUrl,
              data     : instance
            }, next);
          }
        );
      } else {
        debug("sending direct message: no relation, no filters");

        // Send Direct Message without filters
        Model.app.pubsub.publish({
          method: ctx.req.method,
          endpoint: ctx.req.originalUrl,
          data: remoteMethodOutput
        }, next);

      }

    }

  });
};
