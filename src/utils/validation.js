export function validateEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

export function validatePassword(password) {
  return password && password.length >= 8;
}

export function sanitizeInput(input) {
  if (typeof input !== "string") return input;
  return input.trim().replace(/[<>]/g, "");
}

export function validateFileUpload(file) {
  const allowedMimes = [
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-excel",
    "text/csv",
  ];
  const maxSize = 50 * 1024 * 1024;

  if (!file) return { valid: false, error: "No file provided" };
  if (file.size > maxSize) return { valid: false, error: "File too large" };
  if (!allowedMimes.includes(file.mimetype)) {
    return { valid: false, error: "Invalid file type" };
  }

  return { valid: true };
}
