const express = require('express');
const axios = require('axios');
const fs = require('fs');

const Keyv = require('keyv');
const db = new Keyv(process.env.KEYV_URI);

const router = express.Router();

const pterodactyl = [{
  "url": process.env.PTERODACTYL_URL, 
  "key": process.env.PTERODACTYL_KEY
}];

function ensureAuthenticated(req, res, next) {
  if (req.isAuthenticated()) return next();
  
  req.session.returnTo = req.originalUrl;
  res.redirect('/');
};

async function checkPassword(email) {
  let password = await db.get(`password-${email}`);
  return password;
};

// Resources

// Figure out how what the user's total resource usage is right now
async function calculateResource(email, resource, isFeatureLimit = false) {
  try {
    // Get user's servers
    const response = await axios.get(`${pterodactyl[0].url}/api/application/users?include=servers&filter[email]=${encodeURIComponent(email)}`, {
      headers: {
        'Authorization': `Bearer ${pterodactyl[0].key}`,
        'Accept': 'Application/vnd.pterodactyl.v1+json'
      }
    });

    // Sum total resources in use
    let totalResources = 0;
    response.data.data[0].attributes.relationships.servers.data.forEach(server => {
      if (isFeatureLimit) {
        totalResources += server.attributes.feature_limits[resource];
      } else {
        totalResources += server.attributes.limits[resource];
      }
    });

    return totalResources;
  } catch (error) {
    fs.appendFile(process.env.LOGS_ERROR_PATH, '[LOG] Failed to calculate resources of all servers combined.' + '\n', function (err) {
      if (err) console.log(`Failed to save log: ${err}`);
    });
  }
};

// Existing resources (the ones in use on servers)
const existingResources = async (email) => {
  return {
    "cpu": await calculateResource(email, 'cpu'),
    "ram": await calculateResource(email, 'memory'),
    "disk": await calculateResource(email, 'disk'),
    "database": await calculateResource(email, 'databases', true),
    "backup": await calculateResource(email, 'backups', true)
  };
};
  
// Max resources (the ones the user has purchased or been given)
const maxResources = async (email) => {
  return {
    "cpu": await db.get(`cpu-${email}`),
    "ram": await db.get(`ram-${email}`),
    "disk": await db.get(`disk-${email}`),
    "database": await db.get(`database-${email}`),
    "backup": await db.get(`backup-${email}`)
  };
};

// Set default resources
async function ensureResourcesExist(email) {
    const resources = await maxResources(email);

    if (!resources.cpu || resources.cpu == 0) {
        await db.set(`cpu-${email}`, process.env.DEFAULT_CPU);
    }

    if (!resources.ram || resources.ram == 0) {
        await db.set(`ram-${email}`, process.env.DEFAULT_RAM);
    }

    if (!resources.disk || resources.disk == 0) {
        await db.set(`disk-${email}`, process.env.DEFAULT_DISK);
    }

    if (!resources.database || resources.database == 0) {
      await db.set(`database-${email}`, process.env.SERVER_DEFAULT_DATABASES);
    }

    if (!resources.backup || resources.backup == 0) {
      await db.set(`backup-${email}`, process.env.SERVER_DEFAULT_BACKUPS);
    }

    // Might as well add the coins too instead of having 2 separate functions
    if (!await db.get(`coins-${email}` || 0)) {
        await db.set(`coins-${email}`, 0.00);
    }
};

// Pages / Routes

router.get('/', (req, res) => {
  res.render('index', {
    req: req, // Requests (queries) 
    name: process.env.APP_NAME, // Dashboard name
    user: req.user // User info (if logged in)
  });
});

router.get('/dashboard', ensureAuthenticated, async (req, res) => {
  try {
  if (!req.user || !req.user.email || !req.user.id) return res.redirect('/login/discord');
    const response = await axios.get(`${pterodactyl[0].url}/api/application/users?include=servers&filter[email]=${encodeURIComponent(req.user.email)}`, {
      headers: {
        'Authorization': `Bearer ${pterodactyl[0].key}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      }
    });
    const servers = response.data.data[0]?.attributes?.relationships?.servers?.data || [];

    // Ensure all resources are set to 0 if they don't exist
    await ensureResourcesExist(req.user.email);

    // Calculate existing and maximum resources
    const existing = await existingResources(req.user.email);
    const max = await maxResources(req.user.email);

    res.render('dashboard', { 
      coins: await db.get(`coins-${req.user.email}`), // User's coins
      req: req, // Request (queries)
      name: process.env.APP_NAME, // Dashboard name
      user: req.user, // User info
      servers, // Servers the user owns
      existing, // Existing resources
      max, // Max resources,
      admin: await db.get(`admin-${req.user.email}`) // Admin status
    });
  } catch (error) {
    res.redirect('/?err=INTERNALERROR');
  }
});
  
router.get('/credentials', ensureAuthenticated, async (req, res) => {
  if (!req.user || !req.user.email || !req.user.id) return res.redirect('/login/discord');
  res.render('credentials', { 
    coins: await db.get(`coins-${req.user.email}`), // User's coins
    req: req, // Request (queries)
    name: process.env.APP_NAME, // Dashboard name
    user: req.user, // User info
    admin: await db.get(`admin-${req.user.email}`), // Admin status
    password: await checkPassword(req.user.email) // Account password
  }) 
});

// Panel

router.get('/panel', (req, res) => {
  res.redirect(`${process.env.PTERODACTYL_URL}/auth/login`);
});

// Assets

router.use('/public', express.static('public'));

module.exports = router;