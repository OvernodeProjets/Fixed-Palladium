require("dotenv").config();

const express = require("express");
const router = express.Router();

const path = require("path");
const fs = require("fs");

const db = require("../handlers/db");
const { logError, log, logToDiscord } = require("../handlers/logs");

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

const resourceCosts = {
  cpu: process.env.CPU_COST,
  ram: process.env.RAM_COST,
  disk: process.env.DISK_COST,
  backup: process.env.BACKUP_COST,
  database: process.env.DATABASE_COST,
  allocation: process.env.ALLOCATION_COST,
};

let earners = {};

// Afk
router.ws("/afkwspath", async (ws, req) => {
  try {
    if (!req.user || !req.user.email) return ws.close();
    if (earners[req.user.email] == true) return ws.close();
    const user = await db.get(`user-${req.user.email}`);
    const timeConf = process.env.AFK_TIME;
    let time = timeConf;
    earners[req.user.email] = true;
    let aba = setInterval(async () => {
      try {
        if (earners[req.user.email] == true) {
          time--;
          if (time <= 0) {
            time = timeConf;
            ws.send(JSON.stringify({ type: "coin" }));
            let r = parseInt(user.coins) + 1;
            user.coins = r;
            await db.set(`user-${req.user.email}`, user);
          }
          ws.send(JSON.stringify({ type: "count", amount: time }));
        }
      } catch (error) {
        console.error(`Error in afkwspath interval: ${error}`);
        clearInterval(aba);
        ws.close();
      }
    }, 1000);
    ws.on("close", async () => {
      delete earners[req.user.email];
      clearInterval(aba);
    });
  } catch (error) {
    logError("Error in afkwspath.", error);
    ws.close();
  }
});

router.get("/afk", ensureAuthenticated, async (req, res) => {
  try {
    if (!req.user || !req.user.email) return res.redirect("/");
    const user = await db.get(`user-${req.user.email}`);
    res.render("afk", {
      req, // Request (queries)
      user: req.user, // User info
      name: process.env.APP_NAME, // App name
      coins: user.coins, // User's coins
      admin: await db.get(`admin-${req.user.email}`), // Admin status
    });
  } catch (error) {
    logError("Error rendering afk page.", error);
    res.redirect("/dashboard?err=INTERNALERROR");
  }
});

// Store
try {
  const plansFilePath = path.join(__dirname, "../storage/plans.json");
  const plansJson = fs.readFileSync(plansFilePath, "utf-8");
  var plans = JSON.parse(plansJson);
} catch (error) {
  logError("Error reading or parsing plans file.", error);
}

router.get("/store", ensureAuthenticated, async (req, res) => {
  try {
    if (!req.user || !req.user.email) return res.redirect("/");
    const user = await db.get(`user-${req.user.email}`);
    const userCurrentPlan = user.plan;

    const resourcePlans = Object.values(plans.PLAN).map((plan) => {
      return {
        ...plan,
        hasPlan: userCurrentPlan === plan.name.toUpperCase(),
      };
    });
    res.render("store", {
      req, // Request (queries)
      user: req.user, // User info
      name: process.env.APP_NAME, // App name
      coins: user.coins, // User's coins
      admin: await db.get(`admin-${req.user.email}`), // Admin status
      resourceCosts: resourceCosts, // Cost Resources
      resourcePlans: resourcePlans, // List plans
    });
  } catch (error) {
    logError("Error rendering store.", error);
    res.redirect("/dashboard?err=INTERNALERROR");
  }
});

router.get("/buyresource", ensureAuthenticated, async (req, res) => {
  try {
    const { resource, amount } = req.query;
    if (!resource || !amount) return res.redirect("/store?err=MISSINGPARAMS");
    if (isNaN(amount) || amount > 10)
      return res.redirect("/store?err=INVALIDAMOUNT");

    const validResources = [
      "cpu",
      "ram",
      "disk",
      "backup",
      "database",
      "allocation",
    ];
    if (!validResources.includes(resource))
      return res.redirect("/store?err=INVALIDRESOURCE");

    const user = await db.get(`user-${req.user.email}`);
    let coins = user.coins;
    let resources = user.resources;

    let currentResources = resources[resource] || 0;

    const resourceMap = {
      cpu: { multiplier: 100, cost: resourceCosts.cpu },
      ram: { multiplier: 1024, cost: resourceCosts.ram },
      disk: { multiplier: 1024, cost: resourceCosts.disk },
      backup: { multiplier: 1, cost: resourceCosts.backup },
      database: { multiplier: 1, cost: resourceCosts.database },
      allocation: { multiplier: 1, cost: resourceCosts.allocation },
    };

    let resourceAmount = resourceMap[resource].multiplier * amount;
    let resourceCost = resourceMap[resource].cost * amount;

    if (coins < resourceCost) return res.redirect("/store?err=NOTENOUGHCOINS");

    resources[resource] = parseInt(currentResources) + parseInt(resourceAmount);
    user.resources = resources;

    const finalsCoins = parseInt(coins) - parseInt(resourceCost);
    user.coins = finalsCoins;

    await db.set(`user-${req.user.email}`, user);

    const message = `${
      req.user.username
    } has purchased \`${resourceAmount} ${resource.toUpperCase()}\` !`;
    logToDiscord("resources purchased", message);
    log(message);

    return res.redirect("/store?success=BOUGHTRESOURCE");
  } catch (error) {
    logError("Error in buyresource.", error);
    return res.redirect("/dashboard?err=INTERNALERROR");
  }
});

router.get("/buyplan", ensureAuthenticated, async (req, res) => {
  try {
    if (!req.query.plan) return res.redirect("/store?err=MISSINGPARAMS");

    const planId = parseInt(req.query.plan);
    if (isNaN(planId)) return res.redirect("/store?err=INVALIDPLAN");

    // Filter
    let selectedPlan = null;
    let selectedPlanName = "";
    for (const key in plans.PLAN) {
      if (plans.PLAN[key].id === planId) {
        selectedPlan = plans.PLAN[key];
        selectedPlanName = key.toUpperCase();
        break;
      }
    }

    // Ensure plan is a valid one
    if (!selectedPlan) return res.redirect("/store?err=INVALIDPLAN");

    const user = await db.get(`user-${req.user.email}`);
    const resources = user.resources;
    let coins = user.coins;
    let currentPlanName = user.plan;

    if (currentPlanName == selectedPlanName)
      return res.redirect("/store?err=ALREADYPLAN");

    // Plan costs
    let planCost = selectedPlan.price;
    if (coins < planCost) return res.redirect("/store?err=NOTENOUGHCOINS");

    let currentPlan = plans.PLAN[currentPlanName];

    let currentResources = {};
    for (const resource in currentPlan.resources) {
      resources[resource] = parseInt(resources[resource]) || 0;
    }

    let resourceUpdates = {};
    for (const resource in selectedPlan.resources) {
      const resourceDifference =
        selectedPlan.resources[resource] - currentPlan.resources[resource];
      resourceUpdates[resource] =
        currentResources[resource] + resourceDifference;
    }

    for (const resource in resourceUpdates) {
      resources[resource] = resourceUpdates[resource];
    }

    user.plan = selectedPlanName;
    const finalsCoins = parseInt(coins) - parseInt(planCost);
    user.coins = finalsCoins;

    user.resources = resources;
    await db.set(`user-${req.user.email}`, user);

    logToDiscord(
      "plan purchased",
      `${req.user.username} has purchased \`${selectedPlanName}\` Plan !`
    );
    log(`${req.user.username} has purchased ${selectedPlanName} Plan !`);

    return res.redirect("/store?success=BOUGHTPLAN");
  } catch (error) {
    logError("Error in buyplan.", error);
    return res.redirect("/dashboard?err=INTERNALERROR");
  }
});

router.get("/dailycoins", ensureAuthenticated, async (req, res) => {
  try {
    if (!req.user || !req.user.email) return res.redirect("/");

    const lastClaimDate = await db.get(`last-claim-${req.user.email}`);
    const today = new Date().toISOString().split("T")[0]; // Format YYYY-MM-DD
    const settings = await db.get("settings");

    if (!settings || typeof settings.dailyCoinsEnabled === "undefined") {
      console.log("Settings not properly defined");
      return res.redirect("/dashboard?err=INTERNALERROR");
    }

    if (
      (!lastClaimDate || lastClaimDate !== today) &&
      settings.dailyCoinsEnabled
    ) {
      const user = await db.get(`user-${req.user.email}`);
      let currentCoins = parseInt(user.coins) || 0;
      let dailyCoins = parseInt(settings.dailyCoins) || 0;

      currentCoins += dailyCoins;
      user.coins = currentCoins;

      await db.set(`user-${req.user.email}`, user);
      await db.set(`last-claim-${req.user.email}`, today);

      return res.redirect("/dashboard?success=DAILYCOINSCLAIMED");
    } else if (lastClaimDate === today) {
      return res.redirect("/dashboard?err=ALREADYCLAIMED");
    } else {
      return res.redirect("/dashboard?err=ALREADYCLAIMED");
    }
  } catch (error) {
    logError("Error claiming daily coins.", error);
    res.redirect("/dashboard?err=INTERNALERROR");
  }
});

module.exports = router;
