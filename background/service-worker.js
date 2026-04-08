// Track tab active time
let activeTabId = null;
let lastActiveTime = Date.now();
let isSystemIdle = false;

// Initialize idle detection
chrome.idle.setDetectionInterval(60);
chrome.idle.onStateChanged.addListener(async (newState) => {
    if (newState === 'active') {
        isSystemIdle = false;
        lastActiveTime = Date.now();
    } else {
        if (!isSystemIdle) {
            await commitCurrentTime();
            isSystemIdle = true;
        }
    }
});

// Storage keys
const TIME_STORAGE_KEY = 'tabTimeTracker';
const SLEEP_LOGS_KEY = 'sleepLogs';

// Helper to get date string
function getDateStr(timestamp) {
    const d = new Date(timestamp || Date.now());
    return d.toISOString().split('T')[0];
}

// Helper to accumulate time for a tab
async function accumulateTime(tabId, timeSpentMs) {
    if (!tabId || timeSpentMs <= 0) return;

    try {
        const tab = await chrome.tabs.get(tabId);
        if (!tab || !tab.url || tab.url.startsWith('chrome://')) return;

        const data = await chrome.storage.local.get([TIME_STORAGE_KEY]);
        const tracker = data[TIME_STORAGE_KEY] || {};
        const url = tab.url;
        const today = getDateStr();

        if (!tracker[url]) {
            tracker[url] = {
                title: tab.title,
                favicon: tab.favIconUrl,
                totalTimeMs: 0,
                lastAccessed: Date.now(),
                dailyTime: {}
            };
        }

        tracker[url].totalTimeMs += timeSpentMs;
        tracker[url].lastAccessed = Date.now();
        tracker[url].title = tab.title;
        if (tab.favIconUrl) tracker[url].favicon = tab.favIconUrl;

        // Track daily time
        if (!tracker[url].dailyTime) tracker[url].dailyTime = {};
        tracker[url].dailyTime[today] = (tracker[url].dailyTime[today] || 0) + timeSpentMs;

        // Cleanup old daily data (keep last 30 days)
        const days = Object.keys(tracker[url].dailyTime).sort();
        if (days.length > 30) {
            delete tracker[url].dailyTime[days[0]];
        }

        await chrome.storage.local.set({ [TIME_STORAGE_KEY]: tracker });
    } catch (e) {
        // Tab might be closed
    }
}

// Centralized commit function
// Cap per-commit time to 5 minutes to prevent sleep/suspend inflation
const MAX_COMMIT_MS = 5 * 60 * 1000;

async function commitCurrentTime() {
    if (activeTabId !== null && !isSystemIdle) {
        const now = Date.now();
        const rawTime = now - lastActiveTime;
        // If gap is huge (computer slept, browser suspended), discard it
        const timeSpent = rawTime > MAX_COMMIT_MS ? 0 : rawTime;
        if (timeSpent > 0) {
            await accumulateTime(activeTabId, timeSpent);
        }
        lastActiveTime = now;
    }
}

// Initialize tracking
async function initTracking() {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs.length > 0) {
        activeTabId = tabs[0].id;
        lastActiveTime = Date.now();
    }
}

initTracking();

// Handle tab activation
chrome.tabs.onActivated.addListener(async (activeInfo) => {
    await commitCurrentTime();
    activeTabId = activeInfo.tabId;
    lastActiveTime = Date.now();
});

// Handle window focus changes
chrome.windows.onFocusChanged.addListener(async (windowId) => {
    await commitCurrentTime();

    if (windowId === chrome.windows.WINDOW_ID_NONE) {
        activeTabId = null;
    } else {
        chrome.tabs.query({ active: true, windowId: windowId }, (tabs) => {
            if (tabs.length > 0) {
                activeTabId = tabs[0].id;
                lastActiveTime = Date.now();
            }
        });
    }
});

// Track when URL updates
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    // If URL changed in the active tab, commit old time and start new timer for new URL
    if (tabId === activeTabId && changeInfo.url) {
        await commitCurrentTime();
    }
});

// ── SCHEMA MIGRATIONS ─────────────────────────────────────────────────────────
// Bump CURRENT_SCHEMA_VERSION whenever you change a storage key name or data shape.
// Add a migration block below for each version transition.
// Storage keys: tabTimeTracker, savedTabs, sleepLogs, _schemaVersion
const CURRENT_SCHEMA_VERSION = 1;

async function runMigrations(previousVersion) {
    // previousVersion is 0 for fresh installs or installs that predate migrations.
    const data = await chrome.storage.local.get([TIME_STORAGE_KEY, 'savedTabs', 'sleepLogs']);

    // ── v0 → v1 ───────────────────────────────────────────────────────────────
    // Ensure every tracker entry has a `dailyTime` object (added in v2 of the
    // extension; entries written by v1 only had totalTimeMs + lastAccessed).
    if (previousVersion < 1) {
        const tracker = data[TIME_STORAGE_KEY] || {};
        let dirty = false;
        Object.values(tracker).forEach(entry => {
            if (!entry.dailyTime) {
                entry.dailyTime = {};
                dirty = true;
            }
        });
        if (dirty) {
            await chrome.storage.local.set({ [TIME_STORAGE_KEY]: tracker });
        }
    }

    // ── future migrations go here ─────────────────────────────────────────────
    // if (previousVersion < 2) { ... }

    await chrome.storage.local.set({ _schemaVersion: CURRENT_SCHEMA_VERSION });
}

// Alarms for background tasks
chrome.runtime.onInstalled.addListener(async (details) => {
    chrome.alarms.create("autoGroupInactive", { periodInMinutes: 60 });
    chrome.alarms.create("heartbeatCommit", { periodInMinutes: 0.5 }); // Every 30 seconds

    if (details.reason === 'install' || details.reason === 'update') {
        const stored = await chrome.storage.local.get(['_schemaVersion']);
        const previousVersion = stored._schemaVersion || 0;
        if (previousVersion < CURRENT_SCHEMA_VERSION) {
            await runMigrations(previousVersion);
        }
    }
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === "autoGroupInactive") {
        await groupInactiveTabs();
    } else if (alarm.name === "heartbeatCommit") {
        if (!isSystemIdle) {
            await commitCurrentTime();
        }
    }
});

async function logSleepEvent(tabCount, tabTitles) {
    const data = await chrome.storage.local.get([SLEEP_LOGS_KEY]);
    const logs = data[SLEEP_LOGS_KEY] || [];

    logs.unshift({
        timestamp: Date.now(),
        count: tabCount,
        titles: tabTitles
    });

    if (logs.length > 50) logs.pop();
    await chrome.storage.local.set({ [SLEEP_LOGS_KEY]: logs });
}

function buildSleepLabel() {
    const d = new Date();
    return `💤 ${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
}

// Rename any legacy 'Zzz' groups to the new timestamped format immediately.
async function renameOldSleepGroups() {
    try {
        const allGroups = await chrome.tabGroups.query({});
        for (const g of allGroups) {
            if (g.title === 'Zzz') {
                await chrome.tabGroups.update(g.id, { title: buildSleepLabel() });
            }
        }
    } catch (e) { }
}

async function groupInactiveTabs() {
    const INACTIVE_THRESHOLD_MS = 24 * 60 * 60 * 1000;
    const now = Date.now();
    const label = buildSleepLabel();

    const data = await chrome.storage.local.get([TIME_STORAGE_KEY]);
    const tracker = data[TIME_STORAGE_KEY] || {};
    const tabs = await chrome.tabs.query({ url: ["http://*/*", "https://*/*"] });

    // Step 1: Find all existing sleep groups (rename old 'Zzz' ones in-place)
    const sleepGroups = [];
    try {
        const allGroups = await chrome.tabGroups.query({});
        for (const g of allGroups) {
            if (g.title === 'Zzz') {
                await chrome.tabGroups.update(g.id, { title: label });
                sleepGroups.push({ ...g, title: label });
            } else if (g.title.startsWith('💤')) {
                sleepGroups.push(g);
            }
        }
    } catch (e) { }

    const sleepGroupIds = new Set(sleepGroups.map(g => g.id));

    // Step 2: Detect newly inactive tabs (skip already-sleeping ones)
    const newInactiveIds = [];
    const newInactiveTitles = [];
    for (const tab of tabs) {
        if (tab.active || tab.pinned) continue;
        if (tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE && sleepGroupIds.has(tab.groupId)) continue;
        const tabData = tracker[tab.url];
        if (tabData && tabData.lastAccessed && (now - tabData.lastAccessed > INACTIVE_THRESHOLD_MS)) {
            newInactiveIds.push(tab.id);
            newInactiveTitles.push(tab.title || tab.url);
        }
    }

    // Step 3: Handle grouping
    if (newInactiveIds.length > 0) {
        if (sleepGroups.length === 0) {
            // No existing sleep group — create one
            const groupId = await chrome.tabs.group({ tabIds: newInactiveIds });
            await chrome.tabGroups.update(groupId, { title: label, color: 'grey', collapsed: true });
        } else if (sleepGroups.length === 1) {
            // Add into the one existing group and refresh its timestamp
            await chrome.tabs.group({ tabIds: newInactiveIds, groupId: sleepGroups[0].id });
            await chrome.tabGroups.update(sleepGroups[0].id, { title: label });
        } else {
            // Multiple groups — consolidate everything into one
            const existingIds = tabs
                .filter(t => !t.active && !t.pinned && sleepGroupIds.has(t.groupId))
                .map(t => t.id);
            const groupId = await chrome.tabs.group({ tabIds: [...existingIds, ...newInactiveIds] });
            await chrome.tabGroups.update(groupId, { title: label, color: 'grey', collapsed: true });
        }
        await logSleepEvent(newInactiveIds.length, newInactiveTitles);
    } else if (sleepGroups.length > 1) {
        // No new tabs but multiple sleep groups — consolidate them
        const existingIds = tabs
            .filter(t => !t.active && !t.pinned && sleepGroupIds.has(t.groupId))
            .map(t => t.id);
        if (existingIds.length > 0) {
            const groupId = await chrome.tabs.group({ tabIds: existingIds });
            await chrome.tabGroups.update(groupId, { title: label, color: 'grey', collapsed: true });
        }
    }
    // Single up-to-date group + no new tabs → already renamed above, nothing else to do
}

// Listen for messages
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "manualSleep") {
        groupInactiveTabs().then(() => sendResponse({ success: true }));
        return true;
    }
    if (message.action === "syncTime") {
        Promise.all([commitCurrentTime(), renameOldSleepGroups()])
            .then(() => sendResponse({ success: true }));
        return true;
    }
});
