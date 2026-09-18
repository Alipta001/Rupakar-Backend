// const jwt = require("jsonwebtoken");

// const User = require("../models/user/User");

// const authMiddleware = async (
//   req,
//   res,
//   next
// ) => {

//   try {

//     const authHeader =
//       req.headers.authorization;

//     // Check token
//     if (
//       !authHeader ||
//       !authHeader.startsWith("Bearer ")
//     ) {
//       return res.status(401).json({
//         status: false,
//         message: "Unauthorized access",
//       });
//     }

//     // Extract token
//     const token =
//       authHeader.split(" ")[1];

//     // Verify token
//     const decoded = jwt.verify(
//       token,
//       process.env.JWT_SECRET
//     );

//     // Find user
//     const user = await User.findById(
//       decoded.id
//     ).select("-password");

//     if (!user) {
//       return res.status(401).json({
//         status: false,
//         message: "User not found",
//       });
//     }

//     // Attach user to request
//     req.user = user;

//     next();

//   } catch (error) {

//     console.log(
//       "AUTH MIDDLEWARE ERROR:",
//       error
//     );

//     return res.status(401).json({
//       status: false,
//       message: "Invalid token",
//     });
//   }
// };

// module.exports = authMiddleware;



const jwt = require("jsonwebtoken");
// Note: Changed 'User' to 'user' to stay consistent with your controller's import case
const User = require("../models/user/user"); 
// Import the blacklist model to intercept revoked tokens
const BlacklistedToken = require("../models/token/blacklistedToken");

const authMiddleware = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    // Check token existence and format
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        status: false,
        message: "Unauthorized access",
      });
    }

    // Extract token
    const token = authHeader.split(" ")[1];

    // 1. Check if token is blacklisted (Revoked via Backend Logout)
    const isBlacklisted = await BlacklistedToken.findOne({ token });
    if (isBlacklisted) {
      return res.status(401).json({
        status: false,
        message: "Session expired, please login again",
      });
    }

    // 2. Verify token validity and expiration
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // 3. Find user in database
    const user = await User.findById(decoded.id).select("-password");

    if (!user) {
      return res.status(401).json({
        status: false,
        message: "User not found",
      });
    }

    // Attach user profile directly to the request object
    req.user = user;

    next();

  } catch (error) {
    console.log("AUTH MIDDLEWARE ERROR:", error);

    // Catch expired or tampered token errors specifically
    return res.status(401).json({
      status: false,
      message: "Invalid or expired token",
    });
  }
};

module.exports = authMiddleware;