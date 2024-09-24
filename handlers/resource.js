require('dotenv').config();

const axios = require('axios');
const fs = require('fs');

const { logError } = require('../handlers/logs');
const db = require('../handlers/db');

const provider = {
  url: process.env.PROVIDER_URL,
  key: process.env.PROVIDER_KEY
};

// Figure out how what the user's total resource usage is right now
async function calculateResource(email, resource, isFeatureLimit = false) {
    try {
      // Get user's servers
      const response = await axios.get(`${provider.url}/api/application/users?include=servers&filter[email]=${encodeURIComponent(email)}`, {
        headers: {
          'Authorization': `Bearer ${provider.key}`,
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
      logError('Failed to calculate resources of all servers combined.');
      return 0; // Return a fallback value if the calculation fails
    }
}


const defaultTemplate = {
  "PLAN": {
      "BASIC": {
          "id": 1,
          "name": "Basic",
          "price": 0,
          "resources": {
              "cpu": 100,
              "ram": 1024,
              "disk": 10240,
              "server": 2,
              "database": 2,
              "backup": 2,
              "allocation": 2
          }
      }
  }
};

let plans = {};

try {
    const filePath = './storage/plans.json';

    if (!fs.existsSync(filePath)) {
        console.log("The plans.json file doesn't exist, created with a default template.");

        fs.writeFileSync(filePath, JSON.stringify(defaultTemplate, null, 2), 'utf8');
        plans = defaultTemplate.PLAN;
    } else {
        const data = fs.readFileSync(filePath, 'utf8');
        plans = JSON.parse(data).PLAN;
    }
} catch (err) {
    logError('Error loading plans.', err);
}

async function getUserPlan(email) {
  try {
    let plan = await db.get(`plan-${email}`);
    if (!plan) {
      plan = `${process.env.DEFAULT_PLAN}`; // Default plan
      await db.set(`plan-${email}`, plan);
    }
    return plan.toUpperCase();
  } catch (error) {
    logError('Error getting user plan.', error);
  }
};
  
// Existing resources (the ones in use on servers)
const existingResources = async (email) => {
  try {
    return {
      "cpu": await calculateResource(email, 'cpu'),
      "ram": await calculateResource(email, 'memory'),
      "disk": await calculateResource(email, 'disk'),
      "database": await calculateResource(email, 'databases', true),
      "backup": await calculateResource(email, 'backups', true),
      "allocation": await calculateResource(email, 'allocations', true)
    };
  } catch (error) {
    logError('Failed to fetch existing resources.');
    return {}; // Return empty object if the request fails
  }
};

// Max resources
const maxResources = async (email) => {
  try {
    return {
      "cpu": await db.get(`cpu-${email}`),
      "ram": await db.get(`ram-${email}`),
      "disk": await db.get(`disk-${email}`),
      "database": await db.get(`database-${email}`),
      "backup": await db.get(`backup-${email}`),
      "allocation": await db.get(`allocation-${email}`)
    };
  } catch (error) {
    logError('Failed to fetch max resources.');
    return {}; // Return empty object if the request fails
  }
};

// Set default resources
async function ensureResourcesExist(email) {
  try {
    const planKey = await getUserPlan(email);
    const plan = plans[planKey].resources;
    const resources = await maxResources(email);

    if (!resources.cpu || resources.cpu == 0) {
        await db.set(`cpu-${email}`, plan.cpu);
    }

    if (!resources.ram || resources.ram == 0) {
        await db.set(`ram-${email}`, plan.ram);
    }

    if (!resources.disk || resources.disk == 0) {
        await db.set(`disk-${email}`, plan.disk);
    }

    if (!resources.database || resources.database == 0) {
      await db.set(`database-${email}`, plan.database);
    }

    if (!resources.backup || resources.backup == 0) {
      await db.set(`backup-${email}`, plan.backup);
    }

    if (!resources.server || resources.server == 0) {
      await db.set(`server-${email}`, plan.server);
    }

    if (!resources.allocation || resources.allocation == 0) {
      await db.set(`allocation-${email}`, plan.allocation);
    }

    // Might as well add the coins too instead of having 2 separate functions
    if (!await db.get(`coins-${email}` || 0)) {
        await db.set(`coins-${email}`, 0.00);
    }
  } catch (error) {
    logError('Error ensuring default resources.', error);
  }
};

module.exports = {
    existingResources,
    maxResources,
    ensureResourcesExist
}