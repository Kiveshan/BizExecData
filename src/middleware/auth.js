export function checkAuthenticated(req, res, next) {
  if (req.isAuthenticated()) {
    return next();
  }
  res.redirect("/login");
}

export function checkNotAuthenticated(req, res, next) {
  if (req.isAuthenticated()) {
    return res.redirect("/dashboard");
  }
  next();
}

export function checkAdmin(req, res, next) {
  if (req.isAuthenticated() && req.user && req.user.roleid === 3) {
    return next();
  }
  res.status(403).render("error", {
    statusCode: 403,
    message: "Access denied. Admin privileges required.",
  });
}

export function checkRole(allowedRoles) {
  return (req, res, next) => {
    if (!req.isAuthenticated() || !req.user) {
      return res.redirect("/login");
    }
    if (allowedRoles.includes(req.user.roleid)) {
      return next();
    }
    res.status(403).render("error", {
      statusCode: 403,
      message: "Access denied.",
    });
  };
}
