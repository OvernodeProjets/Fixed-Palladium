require('dotenv').config();

const express = require('express');
const router = express.Router();

const axios = require('axios');

const db = require('../handlers/db');
const { logError } = require('../handlers/logs');
const { existingResources, maxResources } = require('../handlers/resource');

// Resources
const provider = {
  url: process.env.PROVIDER_URL,
  key: process.env.PROVIDER_KEY
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
}

// Delete server
router.get('/delete', ensureAuthenticated, async (req, res) => {
  if (!req.user || !req.user.email || !req.user.id) return res.redirect('/login/discord');
  if (!req.query.id) return res.redirect('../dashboard?err=MISSINGPARAMS');
  try {
    const userId = await db.get(`id-${req.user.email}`);
    const serverId = req.query.id;

    const server = await axios.get(`${provider.url}/api/application/servers/${serverId}`, {
      headers: {
        'Authorization': `Bearer ${provider.key}`,
        'Accept': 'application/json'
      }
    });

    if (server.data.attributes.user !== userId) return res.redirect('../dashboard?err=DONOTOWN');

    await axios.delete(`${provider.url}/api/application/servers/${serverId}`, {
      headers: {
        'Authorization': `Bearer ${provider.key}`,
        'Accept': 'application/json'
      }
    });

    res.redirect('/dashboard?success=DELETE');
  } catch (error) {
    if (error.response && error.response.status === 404) return res.redirect('../dashboard?err=NOTFOUND');
    logError('Error in delete', error);
    res.redirect('/dashboard?err=INTERNALERROR');
  }
});

// Create server
router.get('/create', ensureAuthenticated, async (req, res) => {
  if (!req.user || !req.user.email || !req.user.id) return res.redirect('/login/discord');
  if (!req.query.name || !req.query.location || !req.query.egg || !req.query.cpu || !req.query.ram || !req.query.disk || !req.query.database || !req.query.backup || !req.query.allocation) return res.redirect('../create-server?err=MISSINGPARAMS');

  try {
    // Check if user has enough resources to create a server
    const max = await maxResources(req.user.email);
    const existing = await existingResources(req.user.email);

    // Retrieve the egg configuration
    const eggs = require('../storage/eggs.json');
    const eggId = parseInt(req.query.egg);
    const egg = eggs.find(e => e.id === eggId);
    if (!egg) return res.redirect('../create-server?err=INVALID_EGG');

    const limitsRessources = egg.limitsRessources;

    // Check if requested resources exceed the egg's limits
    if (parseInt(req.query.cpu) > limitsRessources.cpu) return res.redirect('../create-server?err=LIMITRESOURCES_CPU');
    if (parseInt(req.query.ram) > limitsRessources.memory) return res.redirect('../create-server?err=LIMITRESOURCES_RAM');
    if (parseInt(req.query.disk) > limitsRessources.disk) return res.redirect('../create-server?err=LIMITRESOURCES_DISK');

    // Check if user has enough resources left

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

    const userId = await db.get(`id-${req.user.email}`);
    const name = req.query.name;
    const location = parseInt(req.query.location);
    const cpu = parseInt(req.query.cpu);
    const ram = parseInt(req.query.ram);
    const disk = parseInt(req.query.disk);
    const database = parseInt(req.query.database);
    const backup = parseInt(req.query.backup);
    const allocation = parseInt(req.query.allocation);

    const dockerImage = egg.docker_image;
    const startupCommand = egg.startup;
    const environment = egg.settings;

    await axios.post(`${provider.url}/api/application/servers`, {
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
        'Authorization': `Bearer ${provider.key}`
      }
    });

    res.redirect('../dashboard?success=CREATED');
  } catch (error) {
    logError('Error in create', error)
    res.redirect('../create-server?err=ERRORONCREATE');
  }
});

router.get('/create-server', ensureAuthenticated, async (req, res) => {
  if (!req.user || !req.user.email || !req.user.id) return res.redirect('/login/discord');
    res.render('create', {
      req, // Requests (queries) 
      user: req.user, // User info (if logged in)
      name: process.env.APP_NAME, // Dashboard name
      admin: await db.get(`admin-${req.user.email}`), // Admin status
      coins: await db.get(`coins-${req.user.email}`), // Coins
      eggs: require('../storage/eggs.json'), // Eggs data
      locations: require('../storage/locations.json') // Locations data
    });
});

// Edit server
router.get('/edit', ensureAuthenticated, async (req, res) => {
  if (!req.user || !req.user.email || !req.user.id) return res.redirect('/login/discord');
  if (!req.query.id || !req.query.name || !req.query.egg || !req.query.cpu || !req.query.ram || !req.query.disk || !req.query.database || !req.query.backup || !req.query.allocation) return res.redirect('../dashboard?err=MISSINGPARAMS');

  try {
    const userId = await db.get(`id-${req.user.email}`);
    const serverId = req.query.id;

    const server = await axios.get(`${provider.url}/api/application/servers/${serverId}`, {
      headers: {
        'Authorization': `Bearer ${provider.key}`,
        'Accept': 'application/json'
      }
    });

    if (server.data.attributes.user !== userId) return res.redirect('../dashboard?err=DONOTOWN');

    const max = await maxResources(req.user.email);
    const existing = await existingResources(req.user.email);

    if (parseInt(req.query.cpu) > parseInt(max.cpu - existing.cpu)) return res.redirect('../dashboard?err=NOTENOUGHRESOURCES');
    if (parseInt(req.query.ram) > parseInt(max.ram - existing.ram)) return res.redirect('../dashboard?err=NOTENOUGHRESOURCES');
    if (parseInt(req.query.disk) > parseInt(max.disk - existing.disk)) return res.redirect('../dashboard?err=NOTENOUGHRESOURCES');
    if (parseInt(req.query.database) > parseInt(max.database - existing.database)) return res.redirect('../dashboard?err=NOTENOUGHRESOURCES');
    if (parseInt(req.query.backup) > parseInt(max.backup - existing.backup)) return res.redirect('../dashboard?err=NOTENOUGHRESOURCES');
    if (parseInt(req.query.allocation) > parseInt(max.allocation - existing.allocation)) return res.redirect('../dashboard?err=NOTENOUGHRESOURCES');

    // Update the server
    await axios.patch(`${provider.url}/api/application/servers/${serverId}`, {
      name: req.query.name,
      limits: {
        memory: req.query.ram,
        swap: -1,
        disk: req.query.disk,
        io: 500,
        cpu: req.query.cpu
      },
      feature_limits: {
        databases: req.query.database,
        backups: req.query.backup,
        allocations: req.query.allocation
      }
    }, {
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': `Bearer ${provider.key}`
      }
    });

    res.redirect('../dashboard?success=EDITED');
  } catch (error) {
    logError('Error in edit', error)
    res.redirect('../dashboard?err=ERRORONEDIT');
  }
});

module.exports = router;