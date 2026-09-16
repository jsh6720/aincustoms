"use strict";

const { createInternalShareHandler } = require("./internal-share-server");

// Dispatched by the existing API function with an independent auth boundary.
module.exports = createInternalShareHandler();
