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
    const user = await db.get(`user-${email}`);
    const resources = user.resources;
    return {
      "cpu": resources.cpu,
      "ram": resources.ram,
      "disk": resources.disk,
      "database": resources.database,
      "backup": resources.backup,
      "allocation": resources.allocation
    };
  } catch (error) {
    logError('Failed to fetch max resources.');
    return {}; // Return empty object if the request fails
  }
};

module.exports = {
    existingResources,
    maxResources,
    getUserPlan,
    plans
}