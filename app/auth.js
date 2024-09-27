require('dotenv').config();

const express = require('express');
const router = express.Router();

const passport = require('passport');
const DiscordStrategy = require('passport-discord');
const axios = require('axios');

const db = require('../handlers/db');
const { log, logError, logToDiscord } = require('../handlers/logs');
const { encrypt } = require('../handlers/aes');

const provider = {
  url: process.env.PROVIDER_URL,
  key: process.env.PROVIDER_KEY
};

function ensureAuthenticated(req, res, next) {
  if (req.isAuthenticated()) {
      // Check if the user is banned
      db.get(`banned-${req.user.email}`).then(reason => {
          if (reason) return res.redirect(`/?err=BANNED&reason=${encodeURIComponent(reason)}`);

          return next();
      }).catch(err => {
          console.error(err);
          return res.status(500).send('Internal Server Error');
      });
  } else {
      req.session.returnTo = req.originalUrl;
      res.redirect('/');
  }
}

function generateRandomString(length) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// Pterodactyl account system
async function checkAccount(email, username, id) {
  try {
      // Check if user has an account
      let response = await axios.get(`${provider.url}/api/application/users?filter[email]=${email}`, {
          headers: {
            'Authorization': `Bearer ${provider.key}`,
            'Content-Type': 'application/json'
          }
      });
      // If yes, do nothing
      let userId;
      if (response.data.data && response.data.data.length > 0) {
          userId = response.data.data[0].attributes.id;
      } else {
          // If not, create one
          let password = generateRandomString(process.env.PASSWORD_LENGTH);
          response = await axios.post(`${provider.url}/api/application/users`, {
              'username': username,
              'email': email,
              "first_name": id,
              "last_name": 'Palladium User',
              'password': password
          }, {
              headers: {
                'Authorization': `Bearer ${provider.key}`,
                'Content-Type': 'application/json'
              }
          });
          if (response.status === 201) {
            userId = response.data.attributes.id;
            // Set password in the database
            const encryptedPassword = encrypt(password);
            db.set(`password-${email}`, encryptedPassword);

            logToDiscord(
              "signup",
              `${username} logged in to the dashboard for the first time!`
            );
            log('User object created.');
        }
      }
      // Set userID in the database
      await db.set(`id-${email}`, userId);

      logToDiscord(
        "login",
        `${username} logged in to the dashboard !`
      );
      log(`${username} has connected to the dashboard.`);
  } catch (error) {
      logError('Failed to check user information. The panel did not respond correctly.', error);
  }
};

// Configure passport to use Discord
passport.use(new DiscordStrategy({
  clientID: process.env.DISCORD_CLIENT_ID,
  clientSecret: process.env.DISCORD_CLIENT_SECRET,
  callbackURL: process.env.DISCORD_CALLBACK_URL,
  scope: ['identify', 'email']
}, (accessToken, refreshToken, profile, done) => {
  return done(null, profile);
}));

// Serialize and deserialize user
passport.serializeUser((user, done) => {
  done(null, user);
});

passport.deserializeUser((user, done) => {
  done(null, user);
});

// Setup Discord routes
router.get('/login/discord', passport.authenticate('discord'));

router.get('/callback/discord', passport.authenticate('discord', {
  failureRedirect: '/'
}), async (req, res) => {
  await checkAccount(req.user.email, req.user.username, req.user.id);
  return res.redirect(req.session.returnTo || '/dashboard');
});

// Reset password of the user via Pterodactyl API
router.get('/reset-password', ensureAuthenticated, async (req, res) => {
  if (!req.user || !req.user.email || !req.user.id) return res.redirect('/');
    try {
      let password = generateRandomString(process.env.PASSWORD_LENGTH);
  
      const userId = await db.get(`id-${req.user.email}`);
      await axios.patch(`${provider.url}/api/application/users/${userId}`, {
        email: req.user.email,
        username: req.user.username,
        first_name: req.user.id,
        last_name: 'Palladium User',
        language: "en",
        password: password
      }, {
        headers: {
          'Authorization': `Bearer ${provider.key}`,
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        }
      });
      const encryptedPassword = encrypt(password);
      db.set(`password-${req.user.email}`, encryptedPassword)

      logToDiscord(
        "reset password",
        `${req.user.username} has reset him password !`
      );
      log(`Password reset for ${req.user.username}.`);
  
      res.redirect('/credentials');
    } catch (error) {
      logError('Failed to reset password for a user. The panel did not respond correctly.', error);
      res.redirect('/dashboard');
    }
});

router.get('/remove-account', ensureAuthenticated, async (req, res) => {
  if (!req.user || !req.user.email || !req.user.id) return res.redirect('/login/discord');
  try {
    const userId = await db.get(`id-${req.user.email}`);

    let cacheAccount = await axios.get(`${provider.url}/api/application/users/${userId}?include=servers`, {
      headers: { 
          'Content-Type': 'application/json', 
          "Authorization": `Bearer ${provider.key}` 
      }
    }); 

    let servers = cacheAccount.data.attributes.relationships.servers.data;
    for (let server of servers) {
      await axios.delete(`${provider.url}/api/application/servers/${server.attributes.id}`, {
          headers: {
              'Content-Type': 'application/json',
              "Authorization": `Bearer ${provider.key}`
          }
      });
    }

    await axios.delete(`${provider.url}/api/application/users/${userId}`, {
      headers: {
        'Authorization': `Bearer ${provider.key}`,
        'Accept': 'application/json'
      }
    });

    await db.delete(`plan-${req.user.email}`);
    await db.delete(`cpu-${req.user.email}`);
    await db.delete(`ram-${req.user.email}`);
    await db.delete(`disk-${req.user.email}`);
    await db.delete(`database-${req.user.email}`);
    await db.delete(`backup-${req.user.email}`);
    await db.delete(`server-${req.user.email}`);
    await db.delete(`allocation-${req.user.email}`);

    await db.delete(`id-${req.user.email}`);
    await db.delete(`coins-${req.user.email}`);
    await db.delete(`password-${req.user.email}`);

    logToDiscord(
      "reset-password",
      `${req.user.username} has deleted his account !`
    );
    log(`${req.user.username} has deleted him account !`);

    req.logout((err)=>{});
    res.redirect('/');
  } catch (error) {
    logError('Failed to remove user account. The panel did not respond correctly.', error);
    res.redirect('/dashboard?err=INTERNALERROR');
  }
});

// Setup logout route
router.get('/logout', (req, res) => {
  req.logout((err)=>{});
  res.redirect('/');
});

module.exports = router;