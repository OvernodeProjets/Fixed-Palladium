require("dotenv").config();

const express = require("express");
const router = express.Router();

const axios = require("axios");

const db = require("../handlers/db");
const { logError } = require("../handlers/logs");
const { existingResources, maxResources } = require("../handlers/resource");
const { decrypt } = require("../handlers/aes");

const provider = {
  url: process.env.PROVIDER_URL,
  key: process.env.PROVIDER_KEY,
};

async function ensureAuthenticated(req, res, next) {
  if (req.isAuthenticated()) {
    // Check if the user is banned
    await db.get(`banned-${req.user.email}`)
      .then((reason) => {
        if (reason)
          return res.redirect(
            `/?err=BANNED&reason=${encodeURIComponent(reason)}`
          );

        return next();
      })
      .catch((err) => {
        console.error(err);
        return res.status(500).send("Internal Server Error");
      });
  } else {
    req.session.returnTo = req.originalUrl;
    res.redirect("/");
  }
}

async function checkPassword(email) {
  try {
    const user = await db.get(`user-${email}`);
    let password = user.password;
    if (password === "" || !password) {
      return "Password Not Found";
    } else {
      return (password = decrypt(password));
    }
  } catch (error) {
    logError("Error checking password.", error);
  }
}

// Pages / Routes
router.get("/", (req, res) => {
  res.render("index", {
    req, // Requests (queries)
    user: req.user, // User info (if logged in)
    name: process.env.APP_NAME, // Dashboard name
  });
});

// Dashboard
router.get("/dashboard", ensureAuthenticated, async (req, res) => {
  try {
    if (!req.user || !req.user.email) return res.redirect("/");
    const response = await axios.get(
      `${
        provider.url
      }/api/application/users?include=servers&filter[email]=${encodeURIComponent(
        req.user.email
      )}`,
      {
        headers: {
          Authorization: `Bearer ${provider.key}`,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
      }
    );
    const servers =
      response.data.data[0]?.attributes?.relationships?.servers?.data || [];

    // Calculate existing and maximum resources
    const existing = await existingResources(req.user.email);
    const max = await maxResources(req.user.email);

    const settings = await db.get("settings");
    const user = await db.get(`user-${req.user.email}`);
    const lastClaimDate = await db.get(`last-claim-${req.user.email}`);
    const today = new Date().toISOString().split("T")[0]; // Format YYYY-MM-DD
    const dailyCoins = {
      dailyCoinsAmount: settings.dailyCoins,
      lastClaimDate,
      today,
      enabled: settings.dailyCoinsEnabled,
    };

    res.render("dashboard", {
      req, // Request (queries)
      user: req.user, // User info
      name: process.env.APP_NAME, // Dashboard name
      coins: user.coins, // User's coins
      admin: await db.get(`admin-${req.user.email}`), // Admin status
      servers, // Servers the user owns
      existing, // Existing resources
      max, // Max resources
      dailyCoins,
    });
  } catch (error) {
    logError("Error loading dashboard.", error);
    res.redirect("/?err=INTERNALERROR");
  }
});

// Credentials
router.get("/credentials", ensureAuthenticated, async (req, res) => {
  try {
    if (!req.user || !req.user.email) return res.redirect("/");
    const user = await db.get(`user-${req.user.email}`);
    res.render("credentials", {
      req, // Request (queries)
      user: req.user, // User info
      name: process.env.APP_NAME, // Dashboard name
      coins: user.coins, // User's coins
      admin: await db.get(`admin-${req.user.email}`), // Admin status
      password: await checkPassword(req.user.email), // Account password
    });
  } catch (error) {
    logError("Error loading credentials.", error);
    res.redirect("/dashboard?err=INTERNALERROR");
  }
});

// Panel
router.get("/panel", (req, res) => {
  res.redirect(`${provider.url}/auth/login`);
});

// Assets
router.use("/public", express.static("public"));

module.exports = router;
