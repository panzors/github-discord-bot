'use strict';

const { app } = require('@azure/functions');
const { handleDispatch, DISPATCH_QUEUE_NAME } = require('../dispatchWorker');

// Thin Azure wiring: bind the queue trigger to the pure dispatch handler.
app.storageQueue('discordDispatchWorker', {
  queueName: DISPATCH_QUEUE_NAME,
  connection: 'AzureWebJobsStorage',
  handler: handleDispatch,
});

module.exports = { discordDispatchWorker: handleDispatch };
