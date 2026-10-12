// Express 4 does not catch errors thrown inside async handlers: without this the rejection is unhandled and
// Node exits. This hands the error to Express's error handling instead.
export const asyncHandler = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
