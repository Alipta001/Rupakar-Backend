const adminMiddleware = (req, res, next) => {

  try {

    if (req.user.role !== "admin") {
      return res.status(403).json({
        status: false,
        message: "Access denied. Admin only.",
      });
    }

    next();

  } catch (error) {

    return res.status(500).json({
      status: false,
      message: "Authorization failed",
    });
  }
};

module.exports = adminMiddleware;