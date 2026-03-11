export function isAdmin(req, res, next) {
  if (req.user.roleid !== 10) return res.sendStatus(403);
  next();
}
