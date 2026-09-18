export const sendSuccess = (res, data, message = 'Request completed successfully', requestId) => {
  return res.status(200).json({
    success: true,
    data,
    message,
    requestId,
  });
};

export const sendError = (res, statusCode, code, message, requestId) => {
  return res.status(statusCode).json({
    success: false,
    error: {
      code,
      message,
    },
    requestId,
  });
};
