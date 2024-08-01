const express = require('express');
const session = require('express-session');
const fs = require('fs');
const passport = require('passport');
const ejs = require('ejs');
const path = require('path');
const axios = require('axios');
const ipaddr = require('ipaddr.js');
const requestIp = require('request-ip');

require('dotenv').config();

const app = express();
const expressWs = require('express-ws')(app);

const Keyv = require('keyv');
const db = new Keyv(process.env.KEYV_URI);

// Add admin users
if (!process.env.ADMIN_USERS) {
  console.warn('No admin users defined. Skipping admin user creation.');
} else {
  let admins = process.env.ADMIN_USERS.split(',');
  for (let i = 0; i < admins.length; i++) {
    db.set(`admin-${admins[i]}`, true);
  }
}

// Set up ejs as the view engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '/resources'));

// Set up session middleware
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: true
}));

// Initialize passport
app.use(passport.initialize());
app.use(passport.session());

// IP middleware
app.use(requestIp.mw());

// VPN detection middleware
app.use(async (req, res, next) => {
  const ipAddress = req.clientIp;

  if (!ipaddr.isValid(ipAddress)) {
    console.error(`Invalid IP Address: ${ipAddress}`);
    return res.status(400).json('Invalid IP address format.');
  }

  const userIp = ipaddr.process(ipAddress).toString();

  const proxycheck_key = process.env.PROXYCHECK_KEY;
  const proxyResponse = await axios.get(`http://proxycheck.io/v2/${userIp}?key=${proxycheck_key}`);
  const proxyData = proxyResponse.data;

  if (proxyData[userIp] && proxyData[userIp].proxy === 'yes') {
    return res.status(403).json('It seems we have detected a proxy/VPN enabled on your end, please turn it off to continue.');
  }

  next();
});

// Require the routes
let allRoutes = fs.readdirSync('./app');
for (let i = 0; i < allRoutes.length; i++) {
  let route = require(`./app/${allRoutes[i]}`);
  expressWs.applyTo(route);
  app.use('/', route);
}

// Serve static files (after VPN detection)
app.use(express.static(path.join(__dirname, 'public')));

// Start the server
app.listen(process.env.APP_PORT || 3000, () => {
  console.log(`Fixed-Palladium has been started on ${process.env.APP_URL} !`);
});
