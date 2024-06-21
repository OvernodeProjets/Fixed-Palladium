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

// Scan eggs

router.get('/scaneggs', ensureAuthenticated, async (req, res) => {
    if (!req.user || !req.user.email || req.user == undefined) return res.redirect('/login/discord');
    if (await db.get(`admin-${req.user.email}`) == true) {
        try {
            // just fetch the first page, i will see that later
            const response = await axios.get(`${process.env.PTERODACTYL_URL}/api/application/nests/1/eggs?include=nest,variables`, {
                headers: {
                    'Authorization': `Bearer ${pterodactyl[0].key}`,
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
                settings: {
                    comment: "You'll need to modify the settings yourself, I'll edit for him to add them later. "
                }
            }));

            let existingEggs = []
            try {
                const existingEggsData = fs.readFileSync('storage/eggs.json');
                existingEggs = JSON.parse(existingEggsData);
            } catch (error) {
                console.log("No existing eggs file found.");
            }

            const allEggs = [...existingEggs, ...formattedEggs]
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

// Set & Add coins

router.get('/addcoins', ensureAuthenticated, async (req, res) => {
  if (!req.user || !req.user.email || !req.user.id) return res.redirect('/login/discord');
    if (await db.get(`admin-${req.user.email}`) == true) {
        
        if(req.query.email == undefined || req.query.amount == undefined) return res.redirect('/admin?err=INVALIDPARAMS');
        let amount = parseInt((await db.get(`coins-${req.query.email}`))) + parseInt(req.query.amount);
        await db.set(`coins-${req.query.email}`, amount);
        res.redirect('/admin?success=COMPLETE');
    } else {
        res.redirect('/dashboard');
    }
});

router.get('/setcoins', ensureAuthenticated, async (req, res) => {
  if (!req.user || !req.user.email || !req.user.id) return res.redirect('/login/discord');
    if (await db.get(`admin-${req.user.email}`) == true) {

        if(req.query.email == undefined || req.query.amount == undefined) return res.redirect('/admin?err=INVALIDPARAMS');
        let amount = parseInt(req.query.amount);
        await db.set(`coins-${req.query.email}`, amount);
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

module.exports = router;