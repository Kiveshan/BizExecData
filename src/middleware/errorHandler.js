export function errorHandler(err, req, res) {
  console.error("Error:", err);

  const isProduction = process.env.NODE_ENV === "production";
  const statusCode = err.statusCode || 500;
  const message = isProduction 
    ? "An error occurred. Please try again later." 
    : err.message;

  res.status(statusCode).render("error", {
    statusCode,
    message,
  });
}

export function notFoundHandler(req, res) {
  res.status(404).render("error", {
    statusCode: 404,
    message: "Page not found",
  });
}
