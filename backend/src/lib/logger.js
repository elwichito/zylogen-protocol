"use strict";

/**
 * logger.js — Structured logging with pino
 *
 * JSON output in production, pretty output in development.
 * Request ID tracking via pino-http middleware.
 */

const pino = require("pino");

const isProduction = process.env.NODE_ENV === "production";

// Base logger configuration
const logger = pino({
  level: process.env.LOG_LEVEL || (isProduction ? "info" : "debug"),
  ...(isProduction
    ? {
        // JSON output for production (Railway, etc.)
        formatters: {
          level: (label) => ({ level: label }),
        },
        timestamp: pino.stdTimeFunctions.isoTime,
      }
    : {
        // Pretty output for development
        transport: {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "HH:MM:ss",
            ignore: "pid,hostname",
          },
        },
      }),
});

/**
 * pino-http middleware factory
 * Adds request logging with auto-generated request IDs
 */
function createRequestLogger() {
  const pinoHttp = require("pino-http");

  return pinoHttp({
    logger,
    // Generate request IDs
    genReqId: (req) => req.headers["x-request-id"] || crypto.randomUUID(),

    // Custom log level based on response status
    customLogLevel: (_req, res, err) => {
      if (res.statusCode >= 500 || err) return "error";
      if (res.statusCode >= 400) return "warn";
      return "info";
    },

    // Customize what gets logged
    serializers: {
      req: (req) => ({
        method: req.method,
        url: req.url,
        // Redact sensitive headers
        headers: {
          "user-agent": req.headers["user-agent"],
          "content-type": req.headers["content-type"],
          "x-request-id": req.headers["x-request-id"],
        },
      }),
      res: (res) => ({
        statusCode: res.statusCode,
      }),
    },

    // Skip health check logging in production to reduce noise
    autoLogging: {
      ignore: (req) => isProduction && req.url === "/health",
    },
  });
}

// Named child loggers for different modules
const loggers = {
  server: logger.child({ module: "server" }),
  nova: logger.child({ module: "nova" }),
  payment: logger.child({ module: "payment" }),
  email: logger.child({ module: "email" }),
  webhook: logger.child({ module: "webhook" }),
};

module.exports = {
  logger,
  createRequestLogger,
  ...loggers,
};
