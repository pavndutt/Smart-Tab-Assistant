import os

service_worker_content = """// Track tab active time
let activeTabId = null;
let lastActiveTime = Date.now();

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
async function commitCurrentTime() {
    if (activeTabId !== null) {
        const now = Date.now();
        const timeSpent = now - lastActiveTime;
        if (timeSpent > 0) {
            await accumulateTime(activeTabId, timeSpent);
            lastActiveTime = now;
        }
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

// Alarms for background tasks
chrome.runtime.onInstalled.addListener(() => {
    chrome.alarms.create("autoGroupInactive", { periodInMinutes: 60 });
    chrome.alarms.create("heartbeatCommit", { periodInMinutes: 0.5 }); // Every 30 seconds
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === "autoGroupInactive") {
        await groupInactiveTabs();
    } else if (alarm.name === "heartbeatCommit") {
        await commitCurrentTime();
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

async function groupInactiveTabs() {
    const INACTIVE_THRESHOLD_MS = 24 * 60 * 60 * 1000;
    const now = Date.now();

    const data = await chrome.storage.local.get([TIME_STORAGE_KEY]);
    const tracker = data[TIME_STORAGE_KEY] || {};

    const tabs = await chrome.tabs.query({ url: ["http://*/*", "https://*/*"] });
    const inactiveTabIds = [];
    const inactiveTabTitles = [];

    for (const tab of tabs) {
        if (tab.active || tab.pinned) continue;

        const tabData = tracker[tab.url];
        if (tabData && tabData.lastAccessed && (now - tabData.lastAccessed > INACTIVE_THRESHOLD_MS)) {
            if (tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) {
                try {
                    const group = await chrome.tabGroups.get(tab.groupId);
                    if (group.title === "Zzz") continue;
                } catch (e) { }
            }
            inactiveTabIds.push(tab.id);
            inactiveTabTitles.push(tab.title || tab.url);
        }
    }

    if (inactiveTabIds.length > 0) {
        const groupId = await chrome.tabs.group({ tabIds: inactiveTabIds });
        await chrome.tabGroups.update(groupId, { title: "Zzz", color: "grey", collapsed: true });
        await logSleepEvent(inactiveTabIds.length, inactiveTabTitles);
    }
}

// Listen for messages
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "manualSleep") {
        groupInactiveTabs().then(() => sendResponse({ success: true }));
        return true;
    }
    if (message.action === "syncTime") {
        commitCurrentTime().then(() => sendResponse({ success: true }));
        return true;
    }
});
"""

with open("background/service-worker.js", "w") as f:
    f.write(service_worker_content)
