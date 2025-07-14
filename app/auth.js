require("dotenv").config();

const express = require("express");
const router = express.Router();

const passport = require("passport");
const LocalStrategy = require("passport-local").Strategy;
const DiscordStrategy = require("passport-discord");
const axios = require("axios");

const db = require("../handlers/db");
const { log, logError, logToDiscord } = require("../handlers/logs");
const { encrypt } = require("../handlers/aes");
const { getUserPlan, plans } = require("../handlers/resource");

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

// Helper function to generate a random string
function generateRandomString(length) {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// Passport local strategy for email/password authentication
passport.use(
  new LocalStrategy(
    {
      usernameField: "email",
      passwordField: "password",
    },
    async (email, password, done) => {
      try {
        const user = await db.get(`user-${email}`);
        const userPassword = user.password;
        const passwordOriginHashed = encrypt(password, userPassword.iv);
        if (!user) {
          return done(null, false, { message: "Incorrect email or password." });
        }

        if (userPassword.encryptedData === passwordOriginHashed.encryptedData) {
          return done(null, user);
        } else {
          return done(null, false, { message: "Incorrect email or password." });
        }
      } catch (error) {
        return done(error);
      }
    }
  )
);

// Passport Discord strategy for Discord authentication
passport.use(
  new DiscordStrategy(
    {
      clientID: process.env.DISCORD_CLIENT_ID,
      clientSecret: process.env.DISCORD_CLIENT_SECRET,
      callbackURL: process.env.DISCORD_CALLBACK_URL,
      scope: ["identify", "email", "guilds.join"],
    },
    (accessToken, refreshToken, profile, done) => {
      profile.accessToken = accessToken;
      return done(null, profile);
    }
  )
);

// Serialize and deserialize user
passport.serializeUser((user, done) => {
  done(null, user.email);
});

passport.deserializeUser(async (email, done) => {
  try {
    const user = await db.get(`user-${email}`);
    if (!user) {
      return done(null, false);
    }
    done(null, user);
  } catch (err) {
    done(err);
  }
});

// Route for local registration
router.post("/register", async (req, res) => {
  try {
    const { email, password, username } = req.body;
    let settings = await db.get("settings");
    const isAdmin = (await db.get(`admin-${email}`)) == true;
    if (settings.maintenance && !isAdmin) {
      return res.redirect("/?err=MAINTENANCE");
    }

    await checkAccountLocal(email, username, password);
    return res.redirect("/login/local");
  } catch (error) {
    logError("Failed to login local.", error);
  }
});

// Route for local login
router.post(
  "/login/local",
  passport.authenticate("local", {
    successRedirect: "/dashboard",
    failureRedirect: "/login/local?err=FAILURE",
  })
);

router.get("/login/local", (req, res) => {
  res.render("login", {
    req,
    name: process.env.APP_NAME,
  });
});

// Helper function to check if a user has a Pterodactyl account, or create one
async function checkAccountLocal(email, username, password) {
  try {
    // Check if user has an account
    let response = await axios.get(
      `${provider.url}/api/application/users?filter[email]=${email}`,
      {
        headers: {
          Authorization: `Bearer ${provider.key}`,
          "Content-Type": "application/json",
        },
      }
    );
    // If yes, do nothing
    let userId;
    if (response.data.data && response.data.data.length > 0) {
      userId = response.data.data[0].attributes.id;
    } else {
      // If not, create one
      response = await axios.post(
        `${provider.url}/api/application/users`,
        {
          username: username,
          email: email,
          first_name: "Palladium User",
          last_name: "Palladium User",
          password: password,
        },
        {
          headers: {
            Authorization: `Bearer ${provider.key}`,
            "Content-Type": "application/json",
          },
        }
      );
      if (response.status === 201) {
        userId = response.data.attributes.id;
        // Set password in the database
        const encryptedPassword = encrypt(password);
        const planKey = await getUserPlan(email) || 'free'; // Default to free plan if undefined
        const plan = plans[planKey]?.resources || {
          cpu: 100,
          ram: 1024,
          disk: 10240,
          database: 2,
          backup: 2,
          allocation: 2
        };

        const newUser = {
          id: userId,
          email,
          username,
          password: encryptedPassword,
          coins: "0",
          resources: {
            cpu: plan.cpu,
            ram: plan.ram,
            disk: plan.disk,
            database: plan.database,
            backup: plan.backup,
            allocation: plan.allocation,
          },
        };

        await db.set(`user-${email}`, newUser);

        logToDiscord(
          "signup",
          `${username} logged in to the dashboard for the first time!`
        );
        log(`${username} has signed up via local auth.`);
      }
    }

    const settings = await db.get("settings");
    if (settings.joinGuildEnabled) {
      try {
        await axios.put(
          `https://discord.com/api/guilds/${process.env.DISCORD_GUILD_ID}/members/${settings.joinGuildID}`,
          {
            access_token,
          },
          {
            headers: {
              Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`,
              "Content-Type": "application/json",
            },
          }
        );
      } catch (error) {
        logError("Failed to add user to Discord server", error);
      }
    }

    // Set user in the database
    const user = await db.get(`user-${email}`);
    const planKey = await getUserPlan(email);
    const plan = plans[planKey].resources;
    if (!user) {
      const encryptedPassword = encrypt(password);
      const newUser = {
        id: userId,
        email,
        username,
        password: encryptedPassword,
        coins: "0",
        resources: {
          cpu: plan.cpu,
          ram: plan.ram,
          disk: plan.disk,
          database: plan.database,
          backup: plan.backup,
          allocation: plan.allocation,
        },
      };

      await db.set(`user-${email}`, newUser);
    }

    logToDiscord("login", `${username} logged in to the dashboard!`);
    log(`${username} has connected to the dashboard.`);
  } catch (error) {
    logError(
      "Failed to check user information. The panel did not respond correctly.",
      error
    );
  }
}

// Route for Discord login
router.get("/login/discord", passport.authenticate("discord"));

// Route for Discord callback
router.get(
  "/callback/discord",
  passport.authenticate("discord", {
    failureRedirect: "/",
  }),
  async (req, res) => {
    try {
      let settings = await db.get("settings");
      const isAdmin = (await db.get(`admin-${req.user.email}`)) == true;
      if (settings.maintenance && !isAdmin) {
        return res.redirect("/?err=MAINTENANCE");
      }

      await checkAccount(
        req.user.email,
        req.user.username,
        req.user.id,
        req.user.accessToken,
        req.user.avatar
      );
      return res.redirect(req.session.returnTo || "/dashboard");
    } catch (error) {
      logError("Failed to login discord.", error);
    }
  }
);

// Helper function to check if a user has a Pterodactyl account, or create one
async function checkAccount(email, username, id, access_token, avatar) {
  try {
    // Check if user has an account
    let response = await axios.get(
      `${provider.url}/api/application/users?filter[email]=${email}`,
      {
        headers: {
          Authorization: `Bearer ${provider.key}`,
          "Content-Type": "application/json",
        },
      }
    );
    // If yes, do nothing
    let userId;
    if (response.data.data && response.data.data.length > 0) {
      userId = response.data.data[0].attributes.id;
    } else {
      // If not, create one
      let password = generateRandomString(process.env.PASSWORD_LENGTH);
      response = await axios.post(
        `${provider.url}/api/application/users`,
        {
          username: username,
          email: email,
          first_name: id,
          last_name: "Palladium User",
          password: password,
        },
        {
          headers: {
            Authorization: `Bearer ${provider.key}`,
            "Content-Type": "application/json",
          },
        }
      );
      if (response.status === 201) {
        userId = response.data.attributes.id;
        // Set password in the database
        const encryptedPassword = encrypt(password);
        const planKey = await getUserPlan(email) || 'free'; // Default to free plan if undefined
        const plan = plans[planKey]?.resources || {
          cpu: 100,
          ram: 1024,
          disk: 10240,
          database: 2,
          backup: 2,
          allocation: 2
        };

        const newUser = {
          id: userId,
          altID: id,
          email,
          username,
          avatar,
          password: encryptedPassword,
          coins: "0",
          resources: {
            cpu: plan.cpu,
            ram: plan.ram,
            disk: plan.disk,
            database: plan.database,
            backup: plan.backup,
            allocation: plan.allocation,
          },
        };

        await db.set(`user-${email}`, newUser);

        logToDiscord(
          "signup",
          `${username} logged in to the dashboard for the first time!`
        );
        log("User object created.");
      }
    }

    const settings = await db.get("settings");
    if (settings.joinGuildEnabled) {
      try {
        await axios.put(
          `https://discord.com/api/guilds/${process.env.DISCORD_GUILD_ID}/members/${settings.joinGuildID}`,
          {
            access_token,
          },
          {
            headers: {
              Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`,
              "Content-Type": "application/json",
            },
          }
        );
      } catch (error) {
        logError("Failed to add user to Discord server", error);
      }
    }

    // Set userID in the database
    let user = await db.get(`user-${email}`);
    const planKey = await getUserPlan(email) || 'free'; // Default to free plan if undefined
    const plan = plans[planKey]?.resources || {
      cpu: 100,
      ram: 1024,
      disk: 10240,
      database: 2,
      backup: 2,
      allocation: 2
    };
    if (!user) {
      user = {
        id: userId,
        altID: id,
        email,
        username,
        avatar,
        password: "",
        coins: "0",
        resources: {
          cpu: plan.cpu,
          ram: plan.ram,
          disk: plan.disk,
          database: plan.database,
          backup: plan.backup,
          allocation: plan.allocation,
        },
      };
    } else {
      user.id = userId;
    }
    await db.set(`user-${email}`, user);

    logToDiscord("login", `${username} logged in to the dashboard!`);
    log(`${username} has connected to the dashboard.`);
  } catch (error) {
    logError(
      "Failed to check user information. The panel did not respond correctly.",
      error
    );
  }
}

// Route for password reset
router.get("/reset-password", ensureAuthenticated, async (req, res) => {
  if (!req.user || !req.user.email) return res.redirect("/");
  try {
    let password = generateRandomString(process.env.PASSWORD_LENGTH);

    const user = await db.get(`user-${req.user.email}`);
    const userId = user.id;
    await axios.patch(
      `${provider.url}/api/application/users/${userId}`,
      {
        email: req.user.email,
        username: req.user.username,
        first_name: req.user.id,
        last_name: "Palladium User",
        language: "en",
        password: password,
      },
      {
        headers: {
          Authorization: `Bearer ${provider.key}`,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
      }
    );

    const encryptedPassword = encrypt(password);
    user.password = encryptedPassword;
    db.set(`user-${req.user.email}`, user);

    logToDiscord(
      "reset-password",
      `${req.user.username} has reset their password!`
    );
    log(`Password reset for ${req.user.username}.`);

    res.redirect("/credentials");
  } catch (error) {
    logError("Failed to reset password for a user.", error);
    res.redirect("/dashboard");
  }
});

// Route to remove account
router.get("/remove-account", ensureAuthenticated, async (req, res) => {
  if (!req.user || !req.user.email) return res.redirect("/");
  try {
    const user = await db.get(`user-${req.user.email}`);
    const userId = user.id;

    let cacheAccount = await axios.get(
      `${provider.url}/api/application/users/${userId}?include=servers`,
      {
        headers: {
          Authorization: `Bearer ${provider.key}`,
          "Content-Type": "application/json",
        },
      }
    );

    let servers = cacheAccount.data.attributes.relationships.servers.data;
    await Promise.all(
      servers.map((server) =>
        axios.delete(
          `${provider.url}/api/application/servers/${server.attributes.id}`,
          {
            headers: {
              Authorization: `Bearer ${provider.key}`,
              "Content-Type": "application/json",
            },
          }
        )
      )
    );

    await axios.delete(`${provider.url}/api/application/users/${userId}`, {
      headers: {
        Authorization: `Bearer ${provider.key}`,
        Accept: "application/json",
      },
    });

    await db.delete(`user-${req.user.email}`);

    logToDiscord(
      "delete-account",
      `${req.user.username} deleted their account!`
    );
    log(`${req.user.username} has deleted their account.`);

    req.logout((err) => {});
    res.redirect("/");
  } catch (error) {
    logError(
      "Failed to remove user account. The panel did not respond correctly.",
      error
    );
    res.redirect("/dashboard?err=INTERNALERROR");
  }
});

// Setup logout route
router.get("/logout", (req, res) => {
  req.logout((err) => {});
  res.redirect("/");
});

module.exports = router;
