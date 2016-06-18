module.exports = function (Model, options) {
  Model.afterRemote('**', (ctx, remoteMethodOutput, next) => {
    if (ctx.req.method === 'GET' || ctx.req.originalUrl.match(/log(in|out)/g)) return next();
    Model.app.pubsub.publish({
      method: ctx.req.method,
      endpoint: ctx.req.originalUrl,
      data: remoteMethodOutput
    }, next);
  });
};
