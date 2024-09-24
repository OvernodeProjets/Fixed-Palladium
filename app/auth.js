require('dotenv').config();

const express = require('express');
const router = express.Router();

const passport = require('passport');
const DiscordStrategy = require('passport-discord');
const axios = require('axios');

const db = require('../handlers/db');
const { log, logError } = require('../handlers/logs');

const provider = {
  url: process.env.PROVIDER_URL,
  key: process.env.PROVIDER_KEY
};

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
              'Content-Type': 'application/json',
              'Accept': 'Application/vnd.pterodactyl.v1+json'
          }
      });
      // If yes, do nothing
      let userId;
      if (response.data.data.length > 0) {
          userId = response.data.data[0].attributes.id;
      } else {
          // If not, create one
          let password = generateRandomString(process.env.PASSWORD_LENGTH);
          response = await axios.post(`${provider.url}/api/application/users`, {
              'email': email,
              'username': username,
              "first_name": id,
              "last_name": 'Palladium User',
              'password': password
          }, {
              headers: {
                  'Authorization': `Bearer ${provider.key}`,
                  'Content-Type': 'application/json',
                  'Accept': 'Application/vnd.pterodactyl.v1+json'
              }
          });

          // Fetch the user's ID
          response = await axios.get(`${provider.url}/api/application/users?filter[email]=${email}`, {
              headers: {
                  'Authorization': `Bearer ${provider.key}`,
                  'Content-Type': 'application/json',
                  'Accept': 'Application/vnd.pterodactyl.v1+json'
              }
          });
          userId = response.data.data[0].attributes.id;
          // Set password in the database & log to console
          db.set(`password-${email}`, password);
          log('User object created.');
      }

      // Set userID in the database
      await db.set(`id-${email}`, userId);
  } catch (error) {
      logError('Failed to check user information. The panel did not respond correctly.');
      res.redirect('/?err=INTERNALERROR');
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
router.get('/reset', async (req, res) => {
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
          'Content-Type': 'application/json',
          'Accept': 'Application/vnd.pterodactyl.v1+json'
        }
      });
  
      db.set(`password-${req.user.email}`, password)
      log('Password reset for user.');
  
      res.redirect('/credentials');
    } catch (error) {
      logError('Failed to reset password for a user. The panel did not respond correctly.');
      res.redirect('/dashboard');
    }
});

// Setup logout route
router.get('/logout', (req, res) => {
  req.logout((err)=>{});
  res.redirect('/');
});

module.exports = router;