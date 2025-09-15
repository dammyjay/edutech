// function ensureAuthenticated(req, res, next) {
//   if (req.isAuthenticated && req.isAuthenticated()) {
//     return next();
//   }

//   // OR: if you store user manually in req.user
//   if (req.user) {
//     return next();
//   }

//   res.redirect("/admin/login"); // or "/login" based on your login route
// }

// function ensureParent(req, res, next) {
//   if (req.session.user && req.session.user.role === "parent") {
//     return next();
//   }
//   return res.status(403).send("Access denied");
// }

// module.exports = { ensureParent };


// module.exports = { ensureAuthenticated };


function ensureAuthenticated(req, res, next) {
  if (req.isAuthenticated && req.isAuthenticated()) {
    return next();
  }

  if (req.user) {
    return next();
  }

  res.redirect("/admin/login");
}

function ensureParent(req, res, next) {
  if (req.session.user && req.session.user.role === "parent") {
    return next();
  }
  return res.status(403).send("Access denied");
}

module.exports = {
  ensureAuthenticated,
  ensureParent,
};
