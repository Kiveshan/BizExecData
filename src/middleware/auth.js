export function checkAuthenticated(req, res, next) {
  if (req.isAuthenticated() || req.session?.userid) {
    return next();
  }
  res.redirect("/login");
}

// For JSON endpoints. The handlers filter by `req.session.userid`, and Prisma
// drops an `undefined` filter entirely, so letting a request through without
// one would return every user's rows.
export function requireApiAuth(req, res, next) {
  if (req.session?.userid) {
    return next();
  }
  res.status(401).json({ error: "Not authenticated" });
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
    if (!(req.isAuthenticated() || req.session?.userid) || !req.user) {
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
