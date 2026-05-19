'use strict';

let client = null;
let steamReady = false;
let steamError = null;

function init() {
    try {
        const Steamworks = require('steamworks.js');
        client = Steamworks.init(107410);
        steamReady = true;
        setInterval(() => {
            try { client.runCallbacks(); } catch (_) {}
        }, 1000 / 60);
        console.log('[Steam] Initialized successfully');
    } catch (err) {
        steamError = err.message;
        console.warn('[Steam] Failed to initialize:', err.message);
    }
}

function status() {
    return { ready: steamReady, error: steamError };
}

async function unsubscribeItems(workshopIds) {
    if (!steamReady) throw new Error('Steam not initialized — make sure Steam is running');
    const results = [];
    for (const id of workshopIds) {
        try {
            await client.workshop.unsubscribeItem(BigInt(id));
            results.push({ id, success: true });
        } catch (err) {
            results.push({ id, success: false, error: err.message });
        }
    }
    return results;
}

function getSubscribedItems() {
    if (!steamReady) return [];
    try {
        return client.workshop.getSubscribedItems().map(id => id.toString());
    } catch (_) {
        return [];
    }
}

module.exports = { init, status, unsubscribeItems, getSubscribedItems };
