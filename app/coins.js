const express = require('express');
const path = require('path');
const fs = require('fs');

const Keyv = require('keyv');
const db = new Keyv(process.env.KEYV_URI);

const router = express.Router();

function ensureAuthenticated(req, res, next) {
    if (req.isAuthenticated()) return next();
     
    req.session.returnTo = req.originalUrl;
    res.redirect('/');
};

const resourceCosts = {
    cpu: process.env.CPU_COST,
    ram: process.env.RAM_COST,
    disk: process.env.DISK_COST,
    backup: process.env.BACKUP_COST,
    database: process.env.DATABASE_COST,
    allocation: process.env.ALLOCATION_COST
};

let earners = {}

// Afk

router.ws('/afkwspath', async (ws, req) => {
    if (!req.user || !req.user.email || !req.user.id) return ws.close();
    if (earners[req.user.email] == true) return ws.close();
    const timeConf = process.env.AFK_TIME;
    let time = timeConf;
    earners[req.user.email] = true;
    let aba = setInterval(async () => {
        if (earners[req.user.email] == true) {
            time--;
            if (time <= 0) {
                time = timeConf;
                ws.send(JSON.stringify({ "type": "coin" }));
                let r = parseInt((await db.get(`coins-${req.user.email}`))) + 1;
                await db.set(`coins-${req.user.email}`, r);
            }
            ws.send(JSON.stringify({ "type": "count", "amount": time }));
        }
    }, 1000);
    ws.on('close', async () => {
        delete earners[req.user.email];
        clearInterval(aba);
    });
});

router.get('/afk', ensureAuthenticated, async (req, res) => {
  if (!req.user || !req.user.email || !req.user.id) return res.redirect('/login/discord');
    res.render('afk', {
        user: req.user, // User info
        coins: await db.get(`coins-${req.user.email}`), // User's coins
        req: req, // Request (queries)
        admin: await db.get(`admin-${req.user.email}`), // Admin status
        name: process.env.APP_NAME // App name
    });
});

// Store

const plansFilePath = path.join(__dirname, '../storage/plans.json');
const plansJson = fs.readFileSync(plansFilePath, 'utf-8');
const plans = JSON.parse(plansJson);

router.get('/store', ensureAuthenticated, async (req, res) => {
  if (!req.user || !req.user.email || !req.user.id) return res.redirect('/login/discord');
    
    const userCurrentPlan = await db.get(`plan-${req.user.email}`);

    const resourcePlans = Object.values(plans.PLAN).map(plan => {
      return {
        ...plan,
        hasPlan: userCurrentPlan === plan.name.toUpperCase()
      };
    });
    res.render('store', {
        user: req.user, // User info
        coins: await db.get(`coins-${req.user.email}`), // User's coins
        req: req, // Request (queries)
        admin: await db.get(`admin-${req.user.email}`), // Admin status
        name: process.env.APP_NAME, // App name
        resourceCosts: resourceCosts, // Cost Ressources
        resourcePlans: resourcePlans // List plans
    });
});

router.get('/buyresource', ensureAuthenticated, async (req, res) => {
    if (req.query.resource == undefined || req.query.amount == undefined) return res.redirect('/store?err=MISSINGPARAMS');
    
    // Ensure amount is a number and is below 10
    if (isNaN(req.query.amount) || req.query.amount > 10) return res.redirect('/store?err=INVALIDAMOUNT');

    // Ensure resource is a valid one
    if (req.query.resource != 'cpu' && req.query.resource != 'ram' && req.query.resource != 'disk' && req.query.resource != 'backup' && req.query.resource != 'database' && req.query.resource != 'allocation') return res.redirect('/store?err=INVALIDRESOURCE');

    let coins = await db.get(`coins-${req.user.email}`);
    let currentResources = await db.get(`${req.query.resource}-${req.user.email}`);

    // Resource amounts & costs
    if (req.query.resource == 'cpu') {
        let resourceAmount = 100 * req.query.amount;
        let resourceCost = resourceCosts.cpu * req.query.amount;

        if (coins < resourceCost) return res.redirect('/store?err=NOTENOUGHCOINS');
        await db.set(`cpu-${req.user.email}`, parseInt(currentResources) + parseInt(resourceAmount));
        await db.set(`coins-${req.user.email}`, parseInt(coins) - parseInt(resourceCost));
        return res.redirect('/store?success=BOUGHTRESOURCE');
    } else if (req.query.resource == 'ram') {
        let resourceAmount = 1024 * req.query.amount;
        let resourceCost = resourceCosts.ram * req.query.amount;

        if (coins < resourceCost) return res.redirect('/store?err=NOTENOUGHCOINS');
        await db.set(`ram-${req.user.email}`, parseInt(currentResources) + parseInt(resourceAmount));
        await db.set(`coins-${req.user.email}`, parseInt(coins) - parseInt(resourceCost));
        return res.redirect('/store?success=BOUGHTRESOURCE');
    } else if (req.query.resource == 'disk') {
        let resourceAmount = 1024 * req.query.amount;
        let resourceCost = resourceCosts.disk * req.query.amount;

        if (coins < resourceCost) return res.redirect('/store?err=NOTENOUGHCOINS');
        await db.set(`disk-${req.user.email}`, parseInt(currentResources) + parseInt(resourceAmount));
        await db.set(`coins-${req.user.email}`, parseInt(coins) - parseInt(resourceCost));
        return res.redirect('/store?success=BOUGHTRESOURCE');
    } else if (req.query.resource == 'backup') {
        let resourceAmount = req.query.amount;
        let resourceCost = resourceCosts.backup * req.query.amount;

        if (coins < resourceCost) return res.redirect('/store?err=NOTENOUGHCOINS');
        await db.set(`backup-${req.user.email}`, parseInt(currentResources) + parseInt(resourceAmount));
        await db.set(`coins-${req.user.email}`, parseInt(coins) - parseInt(resourceCost));
        return res.redirect('/store?success=BOUGHTRESOURCE');
    } else if (req.query.resource == 'database') {
        let resourceAmount = req.query.amount;
        let resourceCost = resourceCosts.database * req.query.amount;

        if (coins < resourceCost) return res.redirect('/store?err=NOTENOUGHCOINS');
        await db.set(`database-${req.user.email}`, parseInt(currentResources) + parseInt(resourceAmount));
        await db.set(`coins-${req.user.email}`, parseInt(coins) - parseInt(resourceCost));
        return res.redirect('/store?success=BOUGHTRESOURCE');
    } else if (req.query.resource == 'allocation') {
        let resourceAmount = req.query.amount;
        let resourceCost = resourceCosts.allocation * req.query.amount;

        if (coins < resourceCost) return res.redirect('/store?err=NOTENOUGHCOINS');
        await db.set(`allocation-${req.user.email}`, parseInt(currentResources) + parseInt(resourceAmount));
        await db.set(`coins-${req.user.email}`, parseInt(coins) - parseInt(resourceCost));
        return res.redirect('/store?success=BOUGHTRESOURCE');
    }
});

router.get('/buyplan', ensureAuthenticated, async (req, res) => {
    if (req.query.plan == undefined) return res.redirect('/store?err=MISSINGPARAMS');

    const planId = parseInt(req.query.plan);
    if (isNaN(planId)) return res.redirect('/store?err=INVALIDPLAN');

    // Filter
    let selectedPlan = null;
    let selectedPlanName = '';
    for (const key in plans.PLAN) {
        if (plans.PLAN[key].id === planId) {
            selectedPlan = plans.PLAN[key];
            selectedPlanName = key.toUpperCase();
            break;
        }
    }

    // Ensure plan is a valid one
    if (!selectedPlan) return res.redirect('/store?err=INVALIDPLAN');

    let coins = await db.get(`coins-${req.user.email}`);
    let currentPlan = await db.get(`plan-${req.user.email}`);

    // Plan costs
    let planCost = selectedPlan.price;
    if (coins < planCost) return res.redirect('/store?err=NOTENOUGHCOINS');
    if (currentPlan == selectedPlanName) return res.redirect('/store?err=ALREADYPLAN');

    await db.set(`plan-${req.user.email}`, selectedPlanName);
    await db.set(`coins-${req.user.email}`, parseInt(coins) - parseInt(planCost));

    // Set resources of plan
    const resources = selectedPlan.resources;
    for (const resource in resources) {
        await db.set(`${resource}-${req.user.email}`, resources[resource]);
    }
    return res.redirect('/store?success=BOUGHTPLAN');
});

module.exports = router;