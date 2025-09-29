


// function ensureAuthenticated(req, res, next) {
//   if (req.isAuthenticated && req.isAuthenticated()) {
//     return next();
//   }

//   if (req.user) {
//     return next();
//   }

//   res.redirect("/admin/login");
// }

// function ensureParent(req, res, next) {
//   if (req.session.user && req.session.user.role === "parent") {
//     return next();
//   }
//   return res.status(403).send("Access denied");
// }

// function ensureInstructorOrAdmin(req, res, next) {
//   if (
//     req.isAuthenticated() &&
//     (req.user.role === "instructor" || req.user.role === "admin")
//   ) {
//     return next();
//   }
//   return res.redirect("/admin/login");
// }


// module.exports = {
//   ensureAuthenticated,
//   ensureParent,
//   ensureInstructorOrAdmin,
// };


// middlewares/auth.js


function ensureAuthenticated(req, res, next) {
  if (req.isAuthenticated && req.isAuthenticated()) {
    return next();
  }
  if (req.user) {
    return next();
  }
  return res.redirect("/admin/login");
}

function ensureParent(req, res, next) {
  if (req.session.user && req.session.user.role === "parent") {
    return next();
  }
  return res.status(403).send("Access denied");
}

function ensureInstructorOrAdmin(req, res, next) {
  if (
    req.isAuthenticated &&
    req.isAuthenticated() &&
    (req.user.role === "instructor" || req.user.role === "admin")
  ) {
    return next();
  }
  return res.redirect("/admin/login");
}

module.exports = {
  ensureAuthenticated,
  ensureParent,
  ensureInstructorOrAdmin,
};

