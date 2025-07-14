require("dotenv").config();

const express = require("express");
const router = express.Router();

const axios = require("axios");
const fs = require("fs");

const db = require("../handlers/db");
const { logError, logToDiscord, log } = require("../handlers/logs");

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

async function ensureAdmin(req, res, next) {
  if (!req.user || !req.user.email) return res.redirect("/");
  const isAdmin = await db.get(`admin-${req.user.email}`);
  if (!isAdmin) return res.redirect("/dashboard");
  next();
}

// Admin
router.get("/admin", ensureAuthenticated, ensureAdmin, async (req, res) => {
  try {
      const settings = await db.get("settings");
      const user = await db.get(`user-${req.user.email}`);

      res.render("admin", {
        req, // Request (queries)
        user: req.user, // User info
        name: process.env.APP_NAME, // App name
        settings: settings || {}, // Settings
        coins: user.coins, // User's coins
        admin: await db.get(`admin-${req.user.email}`), // Admin status
      });
  } catch (error) {
    logError("Error loading admin page.", error);
    res.redirect("/dashboard?err=INTERNALERROR");
  }
});

// Scan eggs & locations
router.get("/scaneggs", ensureAuthenticated, ensureAdmin, async (req, res) => {
  try {
      try {
        const response = await axios.get(
          `${provider.url}/api/application/nests/1/eggs?include=nest,variables`,
          {
            headers: {
              Authorization: `Bearer ${provider.key}`,
              Accept: "application/json",
              "Content-Type": "application/json",
            },
          }
        );

        const eggs = response.data.data;
        const formattedEggs = eggs.map((egg) => ({
          id: egg.attributes.id,
          name: egg.attributes.name,
          description: egg.attributes.description,
          docker_image: egg.attributes.docker_image,
          startup: egg.attributes.startup,
          settings: egg.attributes.relationships.variables.data.reduce(
            (acc, variable) => {
              acc[variable.attributes.env_variable] =
                variable.attributes.default_value;
              return acc;
            },
            {}
          ),
          limitsResources: {
            max: {
              cpu: 100,
              memory: 1024,
              disk: 1024,
            },
            min: {
              cpu: 100,
              memory: 512,
              disk: 512,
            },
          },
        }));

        const filePath = "storage/eggs.json";
        let existingEggs = [];
        if (!fs.existsSync(filePath)) {
          console.log("Eggs file not found, creating a new one.");
          fs.writeFileSync(filePath, JSON.stringify([], null, 2));
        } else {
          const existingEggsData = fs.readFileSync(filePath);
          existingEggs = JSON.parse(existingEggsData);
        }

        const allEggs = [...existingEggs, ...formattedEggs];
        fs.writeFileSync(filePath, JSON.stringify(allEggs, null, 2));

        logToDiscord(
          "scan eggs",
          `${req.user.username} has scanned the eggs !`
        );
        log(`${req.user.username} has scanned the eggs !`);

        res.redirect("/admin?success=COMPLETE");
      } catch (error) {
        console.error(`Error fetching eggs: ${error}`);
        res.redirect("/admin?err=FETCH_FAILED");
      }
  } catch (error) {
    logError("Error loading scaneggs page.", error);
    res.redirect("/dashboard?err=INTERNALERROR");
  }
});

router.get("/scanlocations", ensureAuthenticated, ensureAdmin, async (req, res) => {
  try {
      try {
        const response = await axios.get(
          `${provider.url}/api/application/locations`,
          {
            headers: {
              Authorization: `Bearer ${provider.key}`,
              Accept: "application/json",
              "Content-Type": "application/json",
            },
          }
        );

        const locations = response.data.data;
        const formattedLocations = locations.map((locations) => ({
          id: locations.attributes.id,
          name: locations.attributes.short,
        }));

        const filePath = "storage/locations.json";
        let existingLocations = [];
        if (!fs.existsSync(filePath)) {
          console.log("Locations file not found, creating a new one.");
          fs.writeFileSync(filePath, JSON.stringify([], null, 2));
        } else {
          const existingLocationsData = fs.readFileSync(filePath);
          existingLocations = JSON.parse(existingLocationsData);
        }

        const allLocations = [...existingLocations, ...formattedLocations];
        fs.writeFileSync(filePath, JSON.stringify(allLocations, null, 2));

        logToDiscord(
          "scan locations",
          `${req.user.username} has scanned the locations !`
        );
        log(`${req.user.username} has scanned the locations !`);

        res.redirect("/admin?success=COMPLETE");
      } catch (error) {
        console.error(`Error fetching locations: ${error}`);
        res.redirect("/admin?err=FETCH_FAILED");
      }
  } catch (error) {
    logError("Error loading scanlocations page.", error);
    res.redirect("/dashboard?err=INTERNALERROR");
  }
});

// Set & Add coins
router.get("/addcoins", ensureAuthenticated, ensureAdmin, async (req, res) => {
  try {
      const { email, amount } = req.query;

      if (!email || !amount) return res.redirect("/admin?err=INVALIDPARAMS");

      const user = await db.get(`user-${email}`);

      let amountParse = parseInt(user.coins) + parseInt(amount);
      user.coins = amountParse;
      await db.set(`user-${email}`, user);

      logToDiscord(
        "add coins",
        `${req.user.username} has add \`${amount}\` coins for \`${email}\` !`
      );
      log(`${req.user.username} has add ${amount} coins for ${email} !`);

      res.redirect("/admin?success=COMPLETE");
  } catch (error) {
    logError("Error loading addcoins page.", error);
    res.redirect("/dashboard?err=INTERNALERROR");
  }
});

router.get("/setcoins", ensureAuthenticated, ensureAdmin, async (req, res) => {
  try {
      const { email, amount } = req.query;

      if (!email || !amount) return res.redirect("/admin?err=INVALIDPARAMS");

      const user = await db.get(`user-${email}`);

      let amountParse = parseInt(amount);
      user.coins = amountParse;
      await db.set(`user-${email}`, user);

      logToDiscord(
        "set coins",
        `${req.user.username} has set \`${amount}\` coins for \`${email}\` !`
      );
      log(`${req.user.username} has set ${amount} coins for ${email} !`);

      res.redirect("/admin?success=COMPLETE");
  } catch (error) {
    logError("Error loading setcoins page.", error);
    res.redirect("/dashboard?err=INTERNALERROR");
  }
});

// Set & Add resources
router.get("/addresources", ensureAuthenticated, ensureAdmin, async (req, res) => {
  try {
      const { email, cpu, ram, disk, backup, database, allocation } = req.query;
      if (
        !email ||
        !cpu ||
        !ram ||
        !disk ||
        !backup ||
        !database ||
        !allocation
      )
        return res.redirect("/admin?err=INVALIDPARAMS");

      // Resource amounts
      let cpuAmount = parseInt(cpu) * 100;
      let ramAmount = parseInt(ram) * 1024;
      let diskAmount = parseInt(disk) * 1024;
      let backupAmount = parseInt(backup);
      let databaseAmount = parseInt(database);
      let allocationAmount = parseInt(database);

      // Ensure amount are numbers
      if (
        isNaN(cpuAmount) ||
        isNaN(ramAmount) ||
        isNaN(diskAmount) ||
        isNaN(backupAmount) ||
        isNaN(databaseAmount) ||
        isNaN(allocationAmount)
      )
        return res.redirect("/admin?err=INVALIDAMOUNT");

      // Current resources
      const user = await db.get(`user-${email}`);
      const resources = user.resources;

      let currentCpu = parseInt(resources.cpu) || 0;
      let currentRam = parseInt(resources.ram) || 0;
      let currentDisk = parseInt(resources.disk) || 0;
      let currentBackup = parseInt(resources.backup) || 0;
      let currentDatabase = parseInt(resources.database) || 0;
      let currentAllocation = parseInt(resources.allocation) || 0;

      // Update resources
      resources.cpu = currentCpu + cpuAmount;
      resources.ram = currentRam + ramAmount;
      resources.disk = currentDisk + diskAmount;
      resources.backup = currentBackup + backupAmount;
      resources.database = currentDatabase + databaseAmount;
      resources.allocation = currentAllocation + allocationAmount;

      user.resources = resources;

      await db.set(`user-${email}`, user);

      logToDiscord(
        "add resources",
        `${req.user.username} has add resources for ${email} with : \n\`\`\`CPU: ${cpu}%\nMemory: ${ram} MB\nDisk: ${disk} MB\nBackup: ${backup}\nDatabase: ${database}\nAllocation: ${allocation}\`\`\`!`
      );
      log(`${req.user.username} has add resources for ${email} !`);

      res.redirect("/admin?success=COMPLETE");
  } catch (error) {
    logError("Error loading addresources page.", error);
    res.redirect("/dashboard?err=INTERNALERROR");
  }
});

router.get("/setresources", ensureAuthenticated, ensureAdmin, async (req, res) => {
  try {
      const { email, cpu, ram, disk, backup, database, allocation } = req.query;
      if (
        !email ||
        !cpu ||
        !ram ||
        !disk ||
        !backup ||
        !database ||
        !allocation
      )
        return res.redirect("/admin?err=INVALIDPARAMS");

      // Resource amounts
      let cpuAmount = parseInt(cpu) * 100;
      let ramAmount = parseInt(ram) * 1024;
      let diskAmount = parseInt(disk) * 1024;
      let backupAmount = parseInt(backup);
      let databaseAmount = parseInt(database);
      let allocationAmount = parseInt(allocation);

      // Ensure amount are numbers
      if (
        isNaN(cpuAmount) ||
        isNaN(ramAmount) ||
        isNaN(diskAmount) ||
        isNaN(backupAmount) ||
        isNaN(databaseAmount) ||
        isNaN(allocationAmount)
      )
        return res.redirect("/admin?err=INVALIDAMOUNT");

      // Update resources
      const user = await db.get(`user-${email}`);
      const resources = user.resources;

      resources.cpu = cpuAmount;
      resources.ram = ramAmount;
      resources.disk = diskAmount;
      resources.backup = backupAmount;
      resources.database = databaseAmount;
      resources.allocation = allocationAmount;

      user.resources = resources;

      await db.set(`user-${email}`, user);

      logToDiscord(
        "set resources",
        `${req.user.username} has set resources for ${email} with : \n\`\`\`CPU: ${cpu}%\nMemory: ${ram} MB\nDisk: ${disk} MB\nBackup: ${backup}\nDatabase: ${database}\nAllocation: ${allocation}\`\`\`!`
      );
      log(`${req.user.username} has set resources for ${email} !`);

      res.redirect("/admin?success=COMPLETE");
  } catch (error) {
    logError("Error loading setresources page.", error);
    res.redirect("/dashboard?err=INTERNALERROR");
  }
});

// Ban & Unban
router.get("/ban", ensureAuthenticated, ensureAdmin, async (req, res) => {
  try {
      const { email, reason } = req.query;
      if (!email) return res.redirect("/admin?err=INVALIDPARAMS");

      await db.set(`banned-${email}`, reason);

      logToDiscord(
        "ban",
        `${req.user.username} has ban \`${email}\` with reason \`${reason}\` !`
      );
      log(`${req.user.username} has ban ${email} with reason ${reason} !`);

      res.redirect("/admin?success=BANNED");
  } catch (error) {
    logError("Error loading ban page.", error);
    res.redirect("/dashboard?err=INTERNALERROR");
  }
});

router.get("/unban", ensureAuthenticated, ensureAdmin, async (req, res) => {
  try {
      const { email } = req.query;
      if (!email) return res.redirect("/admin?err=INVALIDPARAMS");

      await db.delete(`banned-${email}`);

      logToDiscord("unban", `${req.user.username} has unban \`${email}\` !`);
      log(`${req.user.username} has unban ${email} !`);

      res.redirect("/admin?success=UNBANNED");
  } catch (error) {
    logError("Error loading unban page.", error);
    res.redirect("/dashboard?err=INTERNALERROR");
  }
});

// Settings
router.post(
  "/admin/settings/joinGuildEnabled",
  ensureAuthenticated,
  ensureAdmin,
  async (req, res) => {
      try {
        if (!req.user || !req.user.email)
          return res.status(401).send("Unauthorized");
        const { joinGuildEnabled } = req.body;
        const settings = await db.get("settings");
        settings.joinGuildEnabled = joinGuildEnabled;
        await db.set("settings", settings);
        res.status(200).send("Settings updated");
      } catch (error) {
        logError("Error updating joinGuildEnabled setting.", error);
        res.status(500).send("Internal Server Error");
      }
  }
);

router.post(
  "/admin/settings/joinGuildID",
  ensureAuthenticated,
  ensureAdmin,
  async (req, res) => {
      try {
        if (!req.user || !req.user.email)
          return res.status(401).send("Unauthorized");
        const { joinGuildID } = req.body;
        const settings = await db.get("settings");
        settings.joinGuildID = `${joinGuildID}`;
        await db.set("settings", settings);
        res.status(200).send("Settings updated");
      } catch (error) {
        logError("Error updating joinGuildID setting.", error);
        res.status(500).send("Internal Server Error");
      }
  }
);

router.post(
  "/admin/settings/maintenanceEnabled",
  ensureAuthenticated,
  ensureAdmin,
  async (req, res) => {
      try {
        if (!req.user || !req.user.email)
          return res.status(401).send("Unauthorized");
        const { maintenanceEnabled } = req.body;
        const settings = await db.get("settings");
        settings.maintenance = maintenanceEnabled;
        await db.set("settings", settings);
        res.status(200).send("Settings updated");
      } catch (error) {
        logError("Error updating maintenanceEnabled setting.", error);
        res.status(500).send("Internal Server Error");
      }
  }
);

router.post(
  "/admin/settings/dailyCoinsEnabled",
  ensureAuthenticated,
  ensureAdmin,
  async (req, res) => {
      try {
        if (!req.user || !req.user.email)
          return res.status(401).send("Unauthorized");
        const { dailyCoinsEnabled } = req.body;
        const settings = await db.get("settings");
        settings.dailyCoinsEnabled = dailyCoinsEnabled;
        await db.set("settings", settings);
        res.status(200).send("Settings updated");
      } catch (error) {
        logError("Error updating dailyCoinsEnabled setting.", error);
        res.status(500).send("Internal Server Error");
      }
  }
);

router.post(
  "/admin/settings/dailyCoinsAmount",
  ensureAuthenticated,
  ensureAdmin,
  async (req, res) => {
      try {
        if (!req.user || !req.user.email)
          return res.status(401).send("Unauthorized");
        const { dailyCoinsAmount } = req.body;
        const settings = await db.get("settings");
        settings.dailyCoins = `${dailyCoinsAmount}`;
        await db.set("settings", settings);
        res.status(200).send("Settings updated");
      } catch (error) {
        logError("Error updating dailyCoinsAmount setting.", error);
        res.status(500).send("Internal Server Error");
      }
  }
);

module.exports = router;
