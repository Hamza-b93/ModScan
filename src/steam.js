'use strict';

let Steamworks = null;
let client = null;
let steamReady = false;
let steamError = null;

function tryInit() {
    if (steamReady) return true;
    try {
        if (!Steamworks) Steamworks = require('steamworks.js');
        client = Steamworks.init(107410);
        steamReady = true;
        steamError = null;
        console.log('[Steam] Initialized successfully');
    } catch (err) {
        steamError = err.message;
        client = null;
        steamReady = false;
    }
    return steamReady;
}

function init() {
    tryInit();
    if (!steamReady) console.warn('[Steam] Failed to initialize:', steamError);
}

function status() {
    tryInit();
    return { ready: steamReady, error: steamError };
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function unsubscribeItems(workshopIds) {
    if (!tryInit()) throw new Error('Steam not initialized — make sure Steam is running');
    const results = [];
    for (const id of workshopIds) {
        try {
            await client.workshop.unsubscribe(BigInt(id));
            results.push({ id, success: true });
        } catch (err) {
            results.push({ id, success: false, error: err.message });
        }
        await sleep(200);
    }
    return results;
}

function getSubscribedItems() {
    if (!tryInit()) return [];
    try {
        return client.workshop.getSubscribedItems().map(id => id.toString());
    } catch (_) {
        return [];
    }
}

module.exports = { init, status, unsubscribeItems, getSubscribedItems };
