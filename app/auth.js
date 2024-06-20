const express = require('express');
const passport = require('passport');
const DiscordStrategy = require('passport-discord');
const axios = require('axios');
const fs = require('fs');
require('dotenv').config();

const Keyv = require('keyv');
const db = new Keyv(process.env.KEYV_URI);

var randomstring = require("randomstring");

const pterodactyl = [{
  "url": process.env.PTERODACTYL_URL, 
  "key": process.env.PTERODACTYL_KEY
}];

const router = express.Router();

// Configure passport to use Discord
const discordStrategy = new DiscordStrategy({
  clientID: process.env.DISCORD_CLIENT_ID,
  clientSecret: process.env.DISCORD_CLIENT_SECRET,
  callbackURL: process.env.DISCORD_CALLBACK_URL,
  scope: ['identify', 'email']
}, (accessToken, refreshToken, profile, done) => {
  return done(null, profile);
});

// Pterodactyl account system
async function checkAccount(email, username, id) {
    try {
      // Check if user has an account
      const response = await axios.get(`${pterodactyl[0].url}/api/application/users?filter[email]=${email}`, {
        headers: {
          'Authorization': `Bearer ${pterodactyl[0].key}`,
          'Content-Type': 'application/json',
          'Accept': 'Application/vnd.pterodactyl.v1+json'
        }
      });
      // If yes, do nothing
      if (response.data.data.length > 0) return;
      // If not, create one
      let password = randomstring.generate(process.env.PASSWORD_LENGTH);
      await axios.post(`${pterodactyl[0].url}/api/application/users`, {
        'email': email,
        'username': username,
        "first_name": id,
        "last_name": 'Palladium User',
        'password': password
      }, {
        headers: {
          'Authorization': `Bearer ${pterodactyl[0].key}`,
          'Content-Type': 'application/json',
          'Accept': 'Application/vnd.pterodactyl.v1+json'
        }
      });

      // Fetch the user's ID
      const fetchId = await axios.get(`${pterodactyl[0].url}/api/application/users?filter[email]=${email}`, {
        headers: {
          'Authorization': `Bearer ${pterodactyl[0].key}`,
          'Content-Type': 'application/json',
          'Accept': 'Application/vnd.pterodactyl.v1+json'
        }
      });
      const userId = fetchId.data.data[0].attributes.id;
      db.set(`id-${email}`, userId);

      fs.appendFile(process.env.LOGS_PATH, '[LOG] User object created.' + '\n', function (err) {
        if (err) console.log(`Failed to save log: ${err}`);
      });
      
      // Set password & log to console
      db.set(`password-${email}`, password);
    } catch (error) {
      fs.appendFile(process.env.LOGS_ERROR_PATH, '[LOG] Failed to check user information. The panel did not respond correctly.' + '\n', function (err) {
        if (err) console.log(`Failed to save log: ${err}`);
      });
    }
};

passport.use(discordStrategy);

// Serialize and deserialize user
passport.serializeUser((user, done) => {
  done(null, user);
});

passport.deserializeUser((user, done) => {
  done(null, user);
});

// Set up Discord routes
router.get('/login/discord', passport.authenticate('discord'), (req, res) => {
  res.redirect('/');
});

router.get('/callback/discord', passport.authenticate('discord', {
  failureRedirect: '/login'
}), (req, res) => {
  checkAccount(req.user.email, req.user.username, req.user.id);
  res.redirect(req.session.returnTo || '/dashboard');
});

// Reset password of the user via Pterodactyl API
router.get('/reset', async (req, res) => {
  if (!req.user || !req.user.email || !req.user.id) return res.redirect('/');
    try {
      // Generate new password
      let password = randomstring.generate(process.env.PASSWORD_LENGTH);
  
      // Update user password in Pterodactyl
      const userId = await db.get(`id-${req.user.email}`);
      await axios.patch(`${pterodactyl[0].url}/api/application/users/${userId}`, {
        email: req.user.email,
        username: req.user.username,
        first_name: req.user.id,
        last_name: 'Palladium User',
        language: "en",
        password: password
      }, {
        headers: {
          'Authorization': `Bearer ${pterodactyl[0].key}`,
          'Content-Type': 'application/json',
          'Accept': 'Application/vnd.pterodactyl.v1+json'
        }
      });
  
      // Update password in database
      db.set(`password-${req.user.email}`, password)
      fs.appendFile(process.env.LOGS_PATH, '[LOG] Password resetted for user.' + '\n', function (err) {
        if (err) console.log(`Failed to save log: ${err}`);
      });
  
      // Load credentials page
      res.redirect('/credentials');

    } catch (error) {
      // Handle error
      fs.appendFile(process.env.LOGS_ERROR_PATH, '[LOG] Failed to reset password for a user. The panel did not respond correctly.' + '\n', function (err) {
        if (err) console.log(`Failed to save log: ${err}`);
      });

      res.status(500).send({
        success: false,
        message: 'Error resetting password'
      });
    }
});

// Set up logout route
router.get('/logout', (req, res) => {
  req.logout((err)=>{});
  res.redirect('/');
});

module.exports = router;