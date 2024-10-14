require('dotenv').config();

const express = require('express');
const router = express.Router();

const path = require('path');
const fs = require('fs');

const db = require('../handlers/db');
const { logError, log, logToDiscord } = require('../handlers/logs');

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

const resourceCosts = {
	cpu: process.env.CPU_COST,
	ram: process.env.RAM_COST,
	disk: process.env.DISK_COST,
	backup: process.env.BACKUP_COST,
	database: process.env.DATABASE_COST,
	allocation: process.env.ALLOCATION_COST
};

let earners = {};

// Afk
router.ws('/afkwspath', async (ws, req) => {
	try {
	    if (!req.user || !req.user.email || !req.user.id) return ws.close();
	    if (earners[req.user.email] == true) return ws.close();
	    const timeConf = process.env.AFK_TIME;
	    let time = timeConf;
	    earners[req.user.email] = true;
	    let aba = setInterval(async () => {
	        try {
	            if (earners[req.user.email] == true) {
	                time--;
	                if (time <= 0) {
	                    time = timeConf;
	                    ws.send(JSON.stringify({ "type": "coin" }));
	                    let r = parseInt(await db.get(`coins-${req.user.email}`)) + 1;
	                    await db.set(`coins-${req.user.email}`, r);
	                }
	                ws.send(JSON.stringify({ "type": "count", "amount": time }));
	            }
	        } catch (error) {
	            console.error(`Error in afkwspath interval: ${error}`);
	            clearInterval(aba);
	            ws.close();
	        }
	    }, 1000);
	    ws.on('close', async () => {
	        delete earners[req.user.email];
	        clearInterval(aba);
	    });
	} catch (error) {
		logError('Error in afkwspath.', error)
	    ws.close();
	}
});

router.get('/afk', ensureAuthenticated, async (req, res) => {
	try {
	    if (!req.user || !req.user.email || !req.user.id) return res.redirect('/login/discord');
	    res.render('afk', {
			req, // Request (queries)
	        user: req.user, // User info
			name: process.env.APP_NAME, // App name
	        coins: await db.get(`coins-${req.user.email}`), // User's coins
	        admin: await db.get(`admin-${req.user.email}`) // Admin status
	    });
	} catch (error) {
		logError('Error rendering afk page.', error);
	    res.redirect('/dashboard?err=INTERNALERROR');
	}
});

// Store
try {
	const plansFilePath = path.join(__dirname, '../storage/plans.json');
	const plansJson = fs.readFileSync(plansFilePath, 'utf-8');
	var plans = JSON.parse(plansJson);
} catch (error) {
	logError('Error reading or parsing plans file.', error)
}

router.get('/store', ensureAuthenticated, async (req, res) => {
	try {
	    if (!req.user || !req.user.email || !req.user.id) return res.redirect('/login/discord');
	    const userCurrentPlan = await db.get(`plan-${req.user.email}`);
	    
	    const resourcePlans = Object.values(plans.PLAN).map(plan => {
	        return {
	            ...plan,
	            hasPlan: userCurrentPlan === plan.name.toUpperCase()
	        };
	    });
	    res.render('store', {
			req, // Request (queries)
	        user: req.user, // User info
			name: process.env.APP_NAME, // App name
	        coins: await db.get(`coins-${req.user.email}`), // User's coins
	        admin: await db.get(`admin-${req.user.email}`), // Admin status
	        resourceCosts: resourceCosts, // Cost Resources
	        resourcePlans: resourcePlans // List plans
	    });
	} catch (error) {
		logError('Error rendering store.', error);
	    res.redirect('/dashboard?err=INTERNALERROR');
	}
});

router.get('/buyresource', ensureAuthenticated, async (req, res) => {
	try {
	    if (!req.query.resource || !req.query.amount) return res.redirect('/store?err=MISSINGPARAMS');
			
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

			logToDiscord(
				"resources purchased",
				`${req.user.username} has purchased \`${resourceAmount} CPU\` !`
			);
			log(`${req.user.username} has purchased ${resourceAmount} CPU !`);

	        return res.redirect('/store?success=BOUGHTRESOURCE');
	    } else if (req.query.resource == 'ram') {
	        let resourceAmount = 1024 * req.query.amount;
	        let resourceCost = resourceCosts.ram * req.query.amount;
	        
	        if (coins < resourceCost) return res.redirect('/store?err=NOTENOUGHCOINS');
	        await db.set(`ram-${req.user.email}`, parseInt(currentResources) + parseInt(resourceAmount));
	        await db.set(`coins-${req.user.email}`, parseInt(coins) - parseInt(resourceCost));

			logToDiscord(
				"resources purchased",
				`${req.user.username} has purchased \`${resourceAmount} RAM\` !`
			);
			log(`${req.user.username} has purchased ${resourceAmount} RAM !`);

	        return res.redirect('/store?success=BOUGHTRESOURCE');
	    } else if (req.query.resource == 'disk') {
	        let resourceAmount = 1024 * req.query.amount;
	        let resourceCost = resourceCosts.disk * req.query.amount;
	        
	        if (coins < resourceCost) return res.redirect('/store?err=NOTENOUGHCOINS');
	        await db.set(`disk-${req.user.email}`, parseInt(currentResources) + parseInt(resourceAmount));
	        await db.set(`coins-${req.user.email}`, parseInt(coins) - parseInt(resourceCost));

			logToDiscord(
				"resources purchased",
				`${req.user.username} has purchased \`${resourceAmount} Disk\` !`
			);
			log(`${req.user.username} has purchased ${resourceAmount} Disk !`);

	        return res.redirect('/store?success=BOUGHTRESOURCE');
	    } else if (req.query.resource == 'backup') {
	        let resourceAmount = req.query.amount;
	        let resourceCost = resourceCosts.backup * req.query.amount;
	        
	        if (coins < resourceCost) return res.redirect('/store?err=NOTENOUGHCOINS');
	        await db.set(`backup-${req.user.email}`, parseInt(currentResources) + parseInt(resourceAmount));
	        await db.set(`coins-${req.user.email}`, parseInt(coins) - parseInt(resourceCost));

			logToDiscord(
				"resources purchased",
				`${req.user.username} has purchased \`${resourceAmount} Backup\` !`
			);
			log(`${req.user.username} has purchased ${resourceAmount} Backup !`);

	        return res.redirect('/store?success=BOUGHTRESOURCE');
	    } else if (req.query.resource == 'database') {
	        let resourceAmount = req.query.amount;
	        let resourceCost = resourceCosts.database * req.query.amount;
	        
	        if (coins < resourceCost) return res.redirect('/store?err=NOTENOUGHCOINS');
	        await db.set(`database-${req.user.email}`, parseInt(currentResources) + parseInt(resourceAmount));
	        await db.set(`coins-${req.user.email}`, parseInt(coins) - parseInt(resourceCost));

			logToDiscord(
				"resources purchased",
				`${req.user.username} has purchased \`${resourceAmount} Database\` !`
			);
			log(`${req.user.username} has purchased ${resourceAmount} Database !`);

	        return res.redirect('/store?success=BOUGHTRESOURCE');
	    } else if (req.query.resource == 'allocation') {
	        let resourceAmount = req.query.amount;
	        let resourceCost = resourceCosts.allocation * req.query.amount;
	        
	        if (coins < resourceCost) return res.redirect('/store?err=NOTENOUGHCOINS');
	        await db.set(`allocation-${req.user.email}`, parseInt(currentResources) + parseInt(resourceAmount));
	        await db.set(`coins-${req.user.email}`, parseInt(coins) - parseInt(resourceCost));

			logToDiscord(
				"resources purchased",
				`${req.user.username} has purchased \`${resourceAmount} Allocation\` !`
			);
			log(`${req.user.username} has purchased ${resourceAmount} Allocation !`);

	        return res.redirect('/store?success=BOUGHTRESOURCE');
	    }
	} catch (error) {
		logError('Error in buyresource.', error);
	    res.redirect('/dashboard?err=INTERNALERROR');
	}
});

router.get('/buyplan', ensureAuthenticated, async (req, res) => {
    try {
        if (!req.query.plan) return res.redirect('/store?err=MISSINGPARAMS');
        
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
        let currentPlanName = await db.get(`plan-${req.user.email}`);

        if (currentPlanName == selectedPlanName) return res.redirect('/store?err=ALREADYPLAN');

        // Plan costs
        let planCost = selectedPlan.price;
        if (coins < planCost) return res.redirect('/store?err=NOTENOUGHCOINS');

        let currentPlan = plans.PLAN[currentPlanName];

        let currentResources = {};
        for (const resource in currentPlan.resources) {
            currentResources[resource] = parseInt(await db.get(`${resource}-${req.user.email}`)) || 0;
        }

        let resourceUpdates = {};
        for (const resource in selectedPlan.resources) {
            const resourceDifference = selectedPlan.resources[resource] - currentPlan.resources[resource];
            resourceUpdates[resource] = currentResources[resource] + resourceDifference;
        }

        for (const resource in resourceUpdates) {
            await db.set(`${resource}-${req.user.email}`, resourceUpdates[resource]);
        }

        await db.set(`plan-${req.user.email}`, selectedPlanName);
        await db.set(`coins-${req.user.email}`, parseInt(coins) - parseInt(planCost));

		logToDiscord(
			"plan purchased",
			`${req.user.username} has purchased \`${selectedPlanName}\` Plan !`
		);
		log(`${req.user.username} has purchased ${selectedPlanName} Plan !`);

        return res.redirect('/store?success=BOUGHTPLAN');
    } catch (error) {
        logError('Error in buyplan.', error);
        return res.redirect('/dashboard?err=INTERNALERROR');
    }
});

router.get('/dailycoins', ensureAuthenticated, async (req, res) => {
    try {
        if (!req.user || !req.user.email || !req.user.id) return res.redirect('/login/discord');

        const lastClaimDate = await db.get(`last-claim-${req.user.email}`);
        const today = new Date().toISOString().split('T')[0]; // Format YYYY-MM-DD
        const settings = await db.get('settings');

        if ((!lastClaimDate|| lastClaimDate !== today ) && settings.dailyCoinsEnabled) {
            let currentCoins = parseInt(await db.get(`coins-${req.user.email}`)) || 0;
            let dailyCoins = parseInt(settings.dailyCoins) || 0;
            currentCoins += dailyCoins;
            await db.set(`coins-${req.user.email}`, currentCoins);
            await db.set(`last-claim-${req.user.email}`, today);

            res.redirect('/dashboard?success=DAILYCOINSCLAIMED');
        } else if (lastClaimDate === today) {
            res.redirect('/dashboard?err=ALREADYCLAIMED');
        }
    } catch (error) {
        logError('Error claiming daily coins.', error);
        res.redirect('/dashboard?err=INTERNALERROR');
    }
});

module.exports = router;