import pino from "pino";

const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  transport: process.env.NODE_ENV === "development" 
    ? { target: "pino-pretty", options: { colorize: true } }
    : undefined,
  base: {
    pid: process.pid,
    env: process.env.NODE_ENV || "production",
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});

export default logger;

export const createModuleLogger = (moduleName) => {
  return logger.child({ module: moduleName });
};
