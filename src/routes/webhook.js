"use strict";

const express = require("express");
const { handleStripeWebhook, rawBodyMiddleware } = require("../services/paymentRelay");

const router = express.Router();

// Stripe requires the raw body — do NOT use express.json() on this route
router.post("/stripe", rawBodyMiddleware, handleStripeWebhook);

module.exports = router;
