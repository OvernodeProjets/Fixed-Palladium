require('dotenv').config();

const express = require('express');
const session = require('express-session');
const app = express();

const expressWs = require('express-ws')(app);
const rateLimit = require('express-rate-limit');
const minifyHTML = require('express-minify-html-2');

const fs = require('fs');
const passport = require('passport');
const ejs = require('ejs');
const path = require('path');
const axios = require('axios');
const ipaddr = require('ipaddr.js');
const requestIp = require('request-ip');
const cache = new Map();

const db = require('./handlers/db');

// Add admin users
if (!process.env.ADMIN_USERS) {
  console.warn('No admin users defined. Skipping admin user creation.');
} else {
  let admins = process.env.ADMIN_USERS.split(',');
  for (let i = 0; i < admins.length; i++) {
    db.set(`admin-${admins[i]}`, true);
  }
}

// Auto Set
async function autoSet() {
  const settings = await db.get('settings') || {};

  const defaultSettings = {
    joinGuildEnabled: false,
    joinGuildID: "",
    maintenance: false,
    dailyCoinsEnabled: false,
    dailyCoins: "10"
  };

  for (const key in defaultSettings) {
    if (!(key in settings)) {
      settings[key] = defaultSettings[key];
    }
  }

  await db.set('settings', settings);
}

autoSet();

// Setup ejs as the view engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '/resources'));

// Trust proxy setting
app.set('trust proxy', 1);

// Setup rateLimit
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  handler: function (req, res) {
    res.status(429).json({
      error: 'Too many requests, please try again later.'
    });
  }
}));

// Parsing query data
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Setup session middleware
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

// Optimization
if (process.env.APP_MODE == "production") {
  app.set('view cache', true);
} else {
  app.set('view cache', false);
}
app.use(minifyHTML({
    override: true,
    exception_url: false,
    htmlMinifier: {
        removeComments: true,
        collapseWhitespace: true,
        collapseBooleanAttributes: true,
        removeAttributeQuotes: true,
        removeEmptyAttributes: true,
        minifyJS: true, 
        minifyCSS: true 
    }
}));

// Custom Header
app.use((req, res, next) => {
  res.setHeader("X-Powered-By", "6th Gen Palladium || 1th Gen Fixed-Palladium");
  next();
});

// VPN detection middleware
app.use(async (req, res, next) => {
  if (process.env.PROXYCHECK_KEY && process.env.PROXYCHECK_KEY !== "0000000000000000000000000000") {
    try {
      const ipAddress = req.clientIp;
    
      if (!ipaddr.isValid(ipAddress)) {
        console.error(`Invalid IP Address: ${ipAddress}`);
        return res.status(400).json('Invalid IP address format.');
      }
    
      const userIp = ipaddr.process(ipAddress).toString();
    
      if (userIp === '127.0.0.1' || userIp.startsWith('192.168') || userIp.startsWith('10.')) {
        return next();
      }
    
      if (cache.has(userIp)) {
        const proxyData = cache.get(userIp);
        if (proxyData.proxy === 'yes') {
          return res.status(403).json('It seems we have detected a proxy/VPN enabled on your end, please turn it off to continue.');
        }
        return next();
      }
    
      const proxyCheckKey = process.env.PROXYCHECK_KEY;
    
      const proxyResponse = await axios.get(`http://proxycheck.io/v2/${userIp}?key=${proxyCheckKey}`);
      const proxyData = proxyResponse.data[userIp];
    
      cache.set(userIp, proxyData);
      setTimeout(() => cache.delete(userIp), 600000);
    
      if (proxyData.proxy === 'yes') {
        return res.status(403).json('It seems we have detected a proxy/VPN enabled on your end, please turn it off to continue.');
      }
    
      next();
    } catch (error) {
      console.error('Error in IP check middleware:', error);
      res.status(500).json('Internal server error.');
    }
} else {
  next();
}});

// Require the routes
let allRoutes = fs.readdirSync('./app');
for (let i = 0; i < allRoutes.length; i++) {
  let route = require(`./app/${allRoutes[i]}`);
  expressWs.applyTo(route);
  app.use('/', route);
}

// 404 handler
app.get('*', (req, res) => {
  res.render('404', { 
    req, // Request (queries)
    name: process.env.APP_NAME, // Dashboard name
  });
});

// Serve static files (after VPN detection)
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: '1d' // Cache static assets for 1 day
}));

// Start the server
app.listen(process.env.APP_PORT || 3000, () => console.log(`Fixed-Palladium has been started on ${process.env.APP_URL} !`));