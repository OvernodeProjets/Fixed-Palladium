const express = require('express');
const axios = require('axios');
const fs = require('fs');

const Keyv = require('keyv');
const db = new Keyv(process.env.KEYV_URI);

const router = express.Router();

const pterodactyl = {
    url: process.env.PTERODACTYL_URL,
    key: process.env.PTERODACTYL_KEY
  };

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

// Admin

router.get('/admin', ensureAuthenticated, async (req, res) => {
  if (!req.user || !req.user.email || !req.user.id) return res.redirect('/login/discord');
    if (await db.get(`admin-${req.user.email}`) == true) {
        res.render('admin', {
            user: req.user, // User info
            coins: await db.get(`coins-${req.user.email}`), // User's coins
            req: req, // Request (queries)
            admin: await db.get(`admin-${req.user.email}`), // Admin status
            name: process.env.APP_NAME // App name
        });
    } else {
        res.redirect('/dashboard');
    }
});

// Scan eggs & locations

router.get('/scaneggs', ensureAuthenticated, async (req, res) => {
    if (!req.user || !req.user.email || !req.user.id) return res.redirect('/login/discord');
    if (await db.get(`admin-${req.user.email}`) == true) {
        try {
            // just fetch the first page, i will see that later
            const response = await axios.get(`${pterodactyl.url}/api/application/nests/1/eggs?include=nest,variables`, {
                headers: {
                    'Authorization': `Bearer ${pterodactyl.key}`,
                    'Accept': 'application/json',
                    'Content-Type': 'application/json'
                }
            });

            const eggs = response.data.data;
            const formattedEggs = eggs.map(egg => ({
                id: egg.attributes.id,
                name: egg.attributes.name,
                description: egg.attributes.description,
                docker_image: egg.attributes.docker_image,
                startup: egg.attributes.startup,
                settings: egg.attributes.relationships.variables.data.reduce((acc, variable) => {
                    acc[variable.attributes.env_variable] = variable.attributes.default_value;
                    return acc;
                }, {})
            }));

            let existingEggs = [];
            try {
                const existingEggsData = fs.readFileSync('storage/eggs.json');
                existingEggs = JSON.parse(existingEggsData);
            } catch (error) {
                console.log("No existing eggs file found.");
            }

            const allEggs = [...existingEggs, ...formattedEggs];
            fs.writeFileSync('storage/eggs.json', JSON.stringify(allEggs, null, 2));

            res.redirect('/admin?success=COMPLETE');
        } catch (error) {
            console.error(`Error fetching eggs: ${error}`);
            res.redirect('/admin?err=FETCH_FAILED');
        }
    } else {
        res.redirect('/dashboard');
    }
});

router.get('/scanlocations', ensureAuthenticated, async (req, res) => {
    if (!req.user || !req.user.email || !req.user.id) return res.redirect('/login/discord');
    if (await db.get(`admin-${req.user.email}`) == true) {
        try {
            const response = await axios.get(`${pterodactyl.url}/api/application/locations`, {
                headers: {
                    'Authorization': `Bearer ${pterodactyl.key}`,
                    'Accept': 'application/json',
                    'Content-Type': 'application/json'
                }
            });
            const locations = response.data.data;
            const formattedLocations = locations.map(locations => ({
                id: locations.attributes.id,
                name: locations.attributes.short
            }));

            let existingLocations = [];
            try {
                const existingLocationsData = fs.readFileSync('storage/locations.json');
                existingLocations = JSON.parse(existingLocationsData);
            } catch (error) {
                console.log("No existing locations file found.");
            }

            const allLocations = [...existingLocations, ...formattedLocations];
            fs.writeFileSync('storage/locations.json', JSON.stringify(allLocations, null, 2));

            res.redirect('/admin?success=COMPLETE');
        } catch (error) {
            console.error(`Error fetching locations: ${error}`);
            res.redirect('/admin?err=FETCH_FAILED');
        }
    } else {
        res.redirect('/dashboard');
    }
});

// Set & Add coins

router.get('/addcoins', ensureAuthenticated, async (req, res) => {
  if (!req.user || !req.user.email || !req.user.id) return res.redirect('/login/discord');
    if (await db.get(`admin-${req.user.email}`) == true) {
        const { email, amount } = req.query;
    
        if (!email || !amount) return res.redirect('/admin?err=INVALIDPARAMS');
        let amountParse = parseInt((await db.get(`coins-${email}`))) + parseInt(amount);
        await db.set(`coins-${email}`, amountParse);
        res.redirect('/admin?success=COMPLETE');
    } else {
        res.redirect('/dashboard');
    }
});

router.get('/setcoins', ensureAuthenticated, async (req, res) => {
  if (!req.user || !req.user.email || !req.user.id) return res.redirect('/login/discord');
    if (await db.get(`admin-${req.user.email}`) == true) {
        const { email, amount } = req.query;

        if (!email || !amount) return res.redirect('/admin?err=INVALIDPARAMS');
        let amountParse = parseInt(amount);
        await db.set(`coins-${email}`, amountParse);
        res.redirect('/admin?success=COMPLETE');
    } else {
        res.redirect('/dashboard');
    }
});

// Set & Add resources

router.get('/addresources', ensureAuthenticated, async (req, res) => {
    if (!req.user || !req.user.email || !req.user.id) return res.redirect('/login/discord');
    if (await db.get(`admin-${req.user.email}`) == true) {
        const { email, cpu, ram, disk, backup, database } = req.query;
        if (!email || !cpu || !ram || !disk || !backup || !database) return res.redirect('/admin?err=INVALIDPARAMS');

        // Resource amounts
        let cpuAmount = parseInt(cpu) * 100;
        let ramAmount = parseInt(ram) * 1024;
        let diskAmount = parseInt(disk) * 1024;
        let backupAmount = parseInt(backup);
        let databaseAmount = parseInt(database);

        // Ensure amount are numbers
        if (isNaN(cpuAmount) || isNaN(ramAmount) || isNaN(diskAmount) || isNaN(backupAmount) || isNaN(databaseAmount)) return res.redirect('/admin?err=INVALIDAMOUNT');
        
        // Current resources
        let currentCpu = parseInt(await db.get(`cpu-${email}`)) || 0;
        let currentRam = parseInt(await db.get(`ram-${email}`)) || 0;
        let currentDisk = parseInt(await db.get(`disk-${email}`)) || 0;
        let currentBackup = parseInt(await db.get(`backup-${email}`)) || 0;
        let currentDatabase = parseInt(await db.get(`database-${email}`)) || 0;

        // Update resources
        await db.set(`cpu-${email}`, currentCpu + cpuAmount);
        await db.set(`ram-${email}`, currentRam + ramAmount);
        await db.set(`disk-${email}`, currentDisk + diskAmount);
        await db.set(`backup-${email}`, currentBackup + backupAmount);
        await db.set(`database-${email}`, currentDatabase + databaseAmount);

        res.redirect('/admin?success=COMPLETE');
    } else {
        res.redirect('/dashboard');
    }
});

router.get('/setresources', ensureAuthenticated, async (req, res) => {
    if (!req.user || !req.user.email || !req.user.id) return res.redirect('/login/discord');
    if (await db.get(`admin-${req.user.email}`) == true) {
        const { email, cpu, ram, disk, backup, database } = req.query;
        if (!email || !cpu || !ram || !disk || !backup || !database) return res.redirect('/admin?err=INVALIDPARAMS');

        // Resource amounts
        let cpuAmount = parseInt(cpu) * 100;
        let ramAmount = parseInt(ram) * 1024;
        let diskAmount = parseInt(disk) * 1024;
        let backupAmount = parseInt(backup);
        let databaseAmount = parseInt(database);

        // Ensure amount are numbers
        if (isNaN(cpuAmount) || isNaN(ramAmount) || isNaN(diskAmount) || isNaN(backupAmount) || isNaN(databaseAmount)) return res.redirect('/admin?err=INVALIDAMOUNT');

        // Update resources
        await db.set(`cpu-${email}`, cpuAmount);
        await db.set(`ram-${email}`, ramAmount);
        await db.set(`disk-${email}`, diskAmount);
        await db.set(`backup-${email}`, backupAmount);
        await db.set(`database-${email}`, databaseAmount);

        res.redirect('/admin?success=COMPLETE');
    } else {
        res.redirect('/dashboard');
    }
});

// Ban & Unban 

router.get('/ban', ensureAuthenticated, async (req, res) => {
    if (!req.user || !req.user.email || !req.user.id) return res.redirect('/login/discord');
    if (await db.get(`admin-${req.user.email}`) == true) {
        const { email, reason } = req.query;
        if (!email) return res.redirect('/admin?err=INVALIDPARAMS');
        
        await db.set(`banned-${email}`, reason);
        res.redirect('/admin?success=BANNED');
    } else {
        res.redirect('/dashboard');
    }
});

router.get('/unban', ensureAuthenticated, async (req, res) => {
    if (!req.user || !req.user.email || !req.user.id) return res.redirect('/login/discord');
    if (await db.get(`admin-${req.user.email}`) == true) {
        const { email } = req.query;
        if (!email) return res.redirect('/admin?err=INVALIDPARAMS');
        
        await db.delete(`banned-${email}`);
        res.redirect('/admin?success=UNBANNED');
    } else {
        res.redirect('/dashboard');
    }
});

module.exports = router;