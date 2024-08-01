const express = require('express');
const axios = require('axios');

const fs = require('fs');

const Keyv = require('keyv');
const db = new Keyv(process.env.KEYV_URI);

const router = express.Router();

// Resources
const pterodactyl = {
  url: process.env.PTERODACTYL_URL,
  key: process.env.PTERODACTYL_KEY
};

// Figure out how what the user's total resource usage is right now
async function calculateResource(email, resource, isFeatureLimit = false) {
  try {
    // Get user's servers
    const response = await axios.get(`${pterodactyl.url}/api/application/users?include=servers&filter[email]=${encodeURIComponent(email)}`, {
      headers: {
        'Authorization': `Bearer ${pterodactyl.key}`,
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
    fs.appendFile(process.env.LOGS_ERROR_PATH, '[LOG] Failed to calculate resources of all servers combined.' + '\n', (err) => {
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

// Decided not to use pterodactyl.* here
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
};

// Delete server
router.get('/delete', ensureAuthenticated, async (req, res) => {
  if (!req.user || !req.user.email || !req.user.id) return res.redirect('/login/discord');
    if (!req.query.id) return res.redirect('../dashboard?err=MISSINGPARAMS');
    try {
        const userId = await db.get(`id-${req.user.email}`);
        const serverId = req.query.id;

        const server = await axios.get(`${pterodactyl.url}/api/application/servers/${serverId}`, {
            headers: {
                'Authorization': `Bearer ${pterodactyl.key}`,
                'Accept': 'application/json'
            }
        });

        if (server.data.attributes.user !== userId) return res.redirect('../dashboard?err=DONOTOWN');

        await axios.delete(`${pterodactyl.url}/api/application/servers/${serverId}`, {
            headers: {
                'Authorization': `Bearer ${pterodactyl.key}`,
                'Accept': 'application/json'
            }
        });

        res.redirect('/dashboard?success=DELETE');
    } catch (error) {
        if (error.response && error.response.status === 404) return res.redirect('../dashboard?err=NOTFOUND');
        
        console.error(error);
        res.redirect('../dashboard?err=INTERNALERROR');
    }
});

// Create server
router.get('/create', ensureAuthenticated, async (req, res) => {
  if (!req.user || !req.user.email || !req.user.id) return res.redirect('/login/discord');
  if (!req.query.name || !req.query.location || !req.query.egg || !req.query.cpu || !req.query.ram || !req.query.disk || !req.query.database || !req.query.backup || !req.query.allocation) return res.redirect('../create-server?err=MISSINGPARAMS');
  
  // Check if user has enough resources to create a server
  const max = await maxResources(req.user.email);
  const existing = await existingResources(req.user.email);

  if (parseInt(req.query.cpu) > parseInt(max.cpu - existing.cpu)) return res.redirect('../create-server?err=NOTENOUGHRESOURCES');
  if (parseInt(req.query.ram) > parseInt(max.ram - existing.ram)) return res.redirect('../create-server?err=NOTENOUGHRESOURCES');
  if (parseInt(req.query.disk) > parseInt(max.disk - existing.disk)) return res.redirect('../create-server?err=NOTENOUGHRESOURCES');
  if (parseInt(req.query.database) > parseInt(max.database - existing.database)) return res.redirect('../create-server?err=NOTENOUGHRESOURCES');
  if (parseInt(req.query.backup) > parseInt(max.backup - existing.backup)) return res.redirect('../create-server?err=NOTENOUGHRESOURCES');
  if (parseInt(req.query.allocation) > parseInt(max.allocation - existing.allocation)) return res.redirect('../create-server?err=NOTENOUGHRESOURCES');

  // Ensure resources are above 128MB / 10%
  if (parseInt(req.query.ram) < 128) return res.redirect('../create-server?err=INVALID');
  if (parseInt(req.query.cpu) < 10) return res.redirect('../create-server?err=INVALID');
  if (parseInt(req.query.disk) < 128) return res.redirect('../create-server?err=INVALID');

  // Name checks
  if (req.query.name.length > 100) return res.redirect('../create-server?err=INVALID');
  if (req.query.name.length < 3) return res.redirect('../create-server?err=INVALID');

  // Make sure locations, eggs, resources are numbers
  if (isNaN(req.query.location) || isNaN(req.query.egg) || isNaN(req.query.cpu) || isNaN(req.query.ram) || isNaN(req.query.disk) || isNaN(req.query.database) || isNaN(req.query.backup) || isNaN(req.query.allocation)) return res.redirect('../create-server?err=INVALID');
  if (req.query.cpu < 1 || req.query.ram < 1 || req.query.disk < 1) return res.redirect('../create-server?err=INVALID');

  try {
      const userId = await db.get(`id-${req.user.email}`);
      const name = req.query.name;
      const location = parseInt(req.query.location);
      const eggId = parseInt(req.query.egg);
      const cpu = parseInt(req.query.cpu);
      const ram = parseInt(req.query.ram);
      const disk = parseInt(req.query.disk);
      const database = parseInt(req.query.database);
      const backup = parseInt(req.query.backup);
      const allocation = parseInt(req.query.allocation);

      const eggs = require('../storage/eggs.json');
      const egg = eggs.find(e => e.id === eggId);
      if (!egg) return res.redirect('../create-server?err=INVALID_EGG');

      const dockerImage = egg.docker_image;
      const startupCommand = egg.startup;
      const environment = egg.settings;

      await axios.post(`${pterodactyl.url}/api/application/servers`, {
          name: name,
          user: userId,
          egg: eggId,
          docker_image: dockerImage,
          startup: startupCommand,
          environment: environment,
          limits: {
              memory: ram,
              swap: -1,
              disk: disk,
              io: 500,
              cpu: cpu
          },
          feature_limits: {
              databases: database,
              backups: backup,
              allocations: allocation
          },
          deploy: {
            locations: [location],
            dedicated_ip: false,
            port_range: []
          }
      }, {
          headers: {
              'Content-Type': 'application/json',
              'Accept': 'application/json',
              'Authorization': `Bearer ${pterodactyl.key}`
          }
      });

      res.redirect('../dashboard?success=CREATED');
  } catch (error) {
      console.error(error);
      res.redirect('../create-server?err=ERRORONCREATE');
  }
});

router.get('/create-server', ensureAuthenticated, async (req, res) => {
  if (!req.user || !req.user.email || !req.user.id) return res.redirect('/login/discord');
    res.render('create', {
      req: req, // Requests (queries) 
      name: process.env.APP_NAME, // Dashboard name
      user: req.user, // User info (if logged in)
      admin: await db.get(`admin-${req.user.email}`), // Admin status
      coins: await db.get(`coins-${req.user.email}`), // Coins
      eggs: require('../storage/eggs.json'), // Eggs data
      locations: require('../storage/locations.json') // Locations data
    });
});

// Edit server
router.get('/edit', ensureAuthenticated, async (req, res) => {
  if (!req.user || !req.user.email || !req.user.id) return res.redirect('/login/discord');
  if (!req.query.id || !req.query.name || !req.query.egg || !req.query.cpu || !req.query.ram || !req.query.disk || !req.query.database || !req.query.backup || !req.query.allocation) return res.redirect(`../edit-server?id=${req.query.id}&err=MISSINGPARAMS`);
  try {
      const userId = await db.get(`id-${req.user.email}`);
      const serverId = req.query.id;
      const server = await axios.get(`${pterodactyl.url}/api/application/servers/${serverId}`, {
          headers: {
              'Authorization': `Bearer ${pterodactyl.key}`,
              'Accept': 'application/json'
          }
      });
      if (server.data.attributes.user !== userId) return res.redirect('../dashboard?err=DONOTOWN');

      // Check if user has enough resources to create a server
      const max = await maxResources(req.user.email);
      
      if (parseInt(req.query.cpu, 10) > max.cpu) return res.redirect(`../edit-server?id=${req.query.id}&err=NOTENOUGHRESOURCES`);
      if (parseInt(req.query.ram, 10) > max.ram) return res.redirect(`../edit-server?id=${req.query.id}&err=NOTENOUGHRESOURCES`);
      if (parseInt(req.query.disk, 10) > max.disk) return res.redirect(`../edit-server?id=${req.query.id}&err=NOTENOUGHRESOURCES`);
      if (parseInt(req.query.database, 10) > max.database) return res.redirect(`../edit-server?id=${req.query.id}&err=NOTENOUGHRESOURCES`);
      if (parseInt(req.query.backup, 10) > max.backup) return res.redirect(`../edit-server?id=${req.query.id}&err=NOTENOUGHRESOURCES`);
      if (parseInt(req.query.allocation, 10) > max.allocation) return res.redirect(`../edit-server?id=${req.query.id}&err=NOTENOUGHRESOURCES`);
      
      // Ensure resources are above 128MB / 10%
      if (parseInt(req.query.ram) < 128) return res.redirect('../edit-server?err=INVALID');
      if (parseInt(req.query.cpu) < 10) return res.redirect('../edit-server?err=INVALID');
      if (parseInt(req.query.disk) < 128) return res.redirect('../edit-server?err=INVALID');

      // Name checks
      if (req.query.name.length > 100) return res.redirect('../edit-server?err=INVALID');
      if (req.query.name.length < 3) return res.redirect('../edit-server?err=INVALID');
      
      // Make sure eggs, resources are numbers
      if (isNaN(req.query.egg) || isNaN(req.query.cpu) || isNaN(req.query.ram) || isNaN(req.query.disk) || isNaN(req.query.database) || isNaN(req.query.backup) || isNaN(req.query.allocation)) return res.redirect('../edit?err=INVALID');
      if (req.query.cpu < 1 || req.query.ram < 1 || req.query.disk < 1) return res.redirect('../edit-server?err=INVALID');

      const reponseServer = await axios.get(`${pterodactyl.url}/api/application/servers/${serverId}`, {
        headers: {
          'Authorization': `Bearer ${pterodactyl.key}`,
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        }
      });

      const patchData = {
        allocation: reponseServer.data.attributes.allocation,
        memory: parseInt(req.query.ram),
        swap: -1,
        io: 500,
        cpu: parseInt(req.query.cpu),
        disk: parseInt(req.query.disk),
        threads: null,
        feature_limits: {
          databases: parseInt(req.query.database),
          allocations: parseInt(req.query.allocation),
          backups: parseInt(req.query.backup)
        }
      };
      await axios.patch(`${pterodactyl.url}/api/application/servers/${serverId}/build`, patchData, {
        headers: {
          'Authorization': `Bearer ${pterodactyl.key}`,
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        }
      });
      res.redirect('/dashboard?success=EDIT');
  } catch (error) {
    if (error.response.status === 404) return res.redirect('../dashboard?err=NOTFOUND');
    
    console.error(error.message);
    res.redirect('../dashboard?err=INTERNALERROR');
  }
});

router.get('/edit-server', ensureAuthenticated, async (req, res) => {
  if (!req.user || !req.user.email || !req.user.id) return res.redirect('/login/discord');
  if (!req.query.id) return res.redirect('/dashboard?err=a');
      const userId = await db.get(`id-${req.user.email}`);
      const server = await axios.get(`${pterodactyl.url}/api/application/servers/${req.query.id}`, {
        headers: {    
        'Authorization': `Bearer ${pterodactyl.key}`,
        'Accept': 'application/json'
        }
    });
    if (server.data.attributes.user !== userId) return res.redirect('../dashboard?err=DONOTOWN');
    res.render('edit', {
      req: req, // Requests (queries) 
      name: process.env.APP_NAME, // Dashboard name
      user: req.user, // User info (if logged in)
      server: server.data.attributes, // Server the user owns
      admin: await db.get(`admin-${req.user.email}`), // Admin status
      coins: await db.get(`coins-${req.user.email}`), // Coins
      eggs: require('../storage/eggs.json') // Eggs data
    });
});

module.exports = router;