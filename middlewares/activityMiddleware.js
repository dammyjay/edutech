// middleware/activityMiddleware.js
const logActivityForUser = require("../utils/activityHelper");

function activityLoggerMiddleware(actionText, detailBuilder, scope = "school") {
  return async (req, res, next) => {
    res.on("finish", async () => {
      // Only log successful requests
      if (res.statusCode < 400) {
        const details =
          typeof detailBuilder === "function"
            ? detailBuilder(req, res)
            : detailBuilder;

        await logActivityForUser(req, actionText, details, scope);
      }
    });
    next();
  };
}

module.exports = activityLoggerMiddleware;
