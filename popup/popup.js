// ── TOOLTIP MANAGER ───────────────────────────────────────────────────────────
// Appended to body so it's never clipped by overflow containers.
(function initTooltip() {
    const tip = document.createElement('div');
    tip.id = 'tooltip-root';
    document.body.appendChild(tip);

    let hideTimer = null;

    document.addEventListener('mouseover', e => {
        const btn = e.target.closest('[data-tooltip]');
        if (!btn) return;
        clearTimeout(hideTimer);
        tip.textContent = btn.dataset.tooltip;
        const r = btn.getBoundingClientRect();
        // Position above the button, centred
        tip.style.left = `${r.left + r.width / 2}px`;
        tip.style.top  = `${r.top - 6}px`;
        tip.style.transform = 'translateX(-50%) translateY(-100%)';
        tip.classList.add('visible');
    });

    document.addEventListener('mouseout', e => {
        const btn = e.target.closest('[data-tooltip]');
        if (!btn) return;
        hideTimer = setTimeout(() => tip.classList.remove('visible'), 80);
    });
})();

document.addEventListener("DOMContentLoaded", async () => {
    // ── CONFIGURATION & STATE ──────────────────────────────
    const TIME_STORAGE_KEY = 'tabTimeTracker';
    const SAVED_TABS_KEY   = 'savedTabs';
    const SLEEP_LOGS_KEY   = 'sleepLogs';

    let currentUsageChart = null;
    let statsPeriod       = 'today';   // for Stats chart
    let topUsagePeriod    = 'alltime'; // for Top Usage list

    // ── DOM ELEMENTS ───────────────────────────────────────
    const duplicateManager  = document.getElementById("duplicate-manager");
    const duplicateCount    = document.getElementById("duplicate-count");
    const cleanDuplicatesBtn = document.getElementById("clean-duplicates-btn");

    const tabButtons  = document.querySelectorAll(".tab-btn");
    const tabContents = document.querySelectorAll(".tab-content");

    const topTabsList   = document.getElementById("top-tabs-list");
    const savedTabsList = document.getElementById("saved-tabs-list");
    const sleepLogsList = document.getElementById("sleep-logs-list");

    const saveTabBtn      = document.getElementById("save-tab-btn");
    const tabNoteInput    = document.getElementById("tab-note");
    const searchTopInput  = document.getElementById("search-top-tabs");
    const searchSavedInput = document.getElementById("search-saved-tabs");
    const manualSleepBtn  = document.getElementById("manual-sleep-btn");
    const headerTabCount  = document.getElementById("header-tab-count");

    const statsPeriodBtns  = document.querySelectorAll(".stats-period-btn");
    const topPeriodPills   = document.querySelectorAll(".period-pill");

    // ── UTILITIES ──────────────────────────────────────────
    function formatTime(ms) {
        if (!ms || ms < 1000) return "< 1s";
        const totalSeconds = Math.floor(ms / 1000);
        const minutes = Math.floor(totalSeconds / 60);
        const hours   = Math.floor(minutes / 60);
        if (hours > 0)   return `${hours}h ${minutes % 60}m`;
        if (minutes > 0) return `${minutes}m`;
        return `${totalSeconds}s`;
    }

    function getDateStr(timestamp) {
        const d = new Date(timestamp || Date.now());
        return d.toISOString().split('T')[0];
    }

    /**
     * Returns the active time (ms) for a tracker entry filtered by period.
     * Uses dailyTime for 'today' and 'week'; totalTimeMs for 'alltime'.
     */
    function getTabTimeForPeriod(data, period) {
        if (period === 'today') {
            const today = getDateStr();
            return (data.dailyTime && data.dailyTime[today]) || 0;
        }
        if (period === 'week') {
            const now = new Date();
            let total = 0;
            for (let i = 0; i < 7; i++) {
                const d = new Date(now);
                d.setDate(d.getDate() - i);
                const dateStr = getDateStr(d.getTime());
                if (data.dailyTime && data.dailyTime[dateStr]) {
                    total += data.dailyTime[dateStr];
                }
            }
            return total;
        }
        // alltime
        return data.totalTimeMs || 0;
    }

    // ── TAB NAVIGATION ────────────────────────────────────
    tabButtons.forEach(btn => {
        btn.addEventListener("click", () => {
            tabButtons.forEach(b => b.classList.remove("active"));
            tabContents.forEach(c => c.classList.remove("active"));
            btn.classList.add("active");
            document.getElementById(`${btn.dataset.tab}-view`).classList.add("active");
            if (btn.dataset.tab === 'stats') renderStats();
        });
    });

    // ── DUPLICATE MANAGER ─────────────────────────────────
    async function checkDuplicates() {
        const tabs = await chrome.tabs.query({ currentWindow: true });
        const urlMap = {};
        const duplicateIds = [];

        tabs.forEach(tab => {
            if (!tab.url) return;
            if (urlMap[tab.url]) {
                duplicateIds.push(tab.id);
            } else {
                urlMap[tab.url] = tab.id;
            }
        });

        if (duplicateIds.length > 0) {
            duplicateManager.classList.remove("hidden");
            duplicateCount.textContent = duplicateIds.length;
            cleanDuplicatesBtn.onclick = async () => {
                await chrome.tabs.remove(duplicateIds);
                duplicateManager.classList.add("hidden");
                refreshUI();
            };
        } else {
            duplicateManager.classList.add("hidden");
        }
    }

    // ── TOP USAGE PERIOD PILLS ────────────────────────────
    topPeriodPills.forEach(pill => {
        pill.addEventListener("click", () => {
            topPeriodPills.forEach(p => p.classList.remove("active"));
            pill.classList.add("active");
            topUsagePeriod = pill.dataset.period;
            renderTopTabs(searchTopInput.value);
        });
    });

    // ── TOP USED TABS ─────────────────────────────────────
    async function renderTopTabs(query = "") {
        topTabsList.innerHTML = "";
        const tabs    = await chrome.tabs.query({});
        const storage = await chrome.storage.local.get([TIME_STORAGE_KEY]);
        const tracker = storage[TIME_STORAGE_KEY] || {};

        const openTabsData = Object.entries(tracker)
            .map(([url, data]) => {
                const activeTab = tabs.find(t => t.url === url);
                const periodTime = getTabTimeForPeriod(data, topUsagePeriod);
                return {
                    url,
                    ...data,
                    periodTime,
                    isOpen:  !!activeTab,
                    tabId:   activeTab ? activeTab.id : null,
                    pinned:  activeTab ? activeTab.pinned : false
                };
            })
            .filter(item => item.isOpen)
            .filter(item => {
                if (!query) return true;
                const q = query.toLowerCase();
                return (item.title && item.title.toLowerCase().includes(q)) ||
                       (item.url   && item.url.toLowerCase().includes(q));
            })
            .sort((a, b) => b.periodTime - a.periodTime);

        if (openTabsData.length === 0) {
            const periodLabel = { today: 'today', week: 'this week', alltime: 'yet' }[topUsagePeriod];
            topTabsList.innerHTML = `
                <li class="empty-state">
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
                    <p>${query ? 'No matching tabs' : `No usage tracked ${periodLabel}`}</p>
                    <span>${query ? 'Try a different search' : 'Browse around and come back!'}</span>
                </li>`;
            return;
        }

        // Max time for progress bar scaling
        const maxTime = openTabsData[0].periodTime || 1;

        openTabsData.forEach((item, index) => {
            const rank = index + 1;
            const rankClass = rank === 1 ? 'gold' : rank === 2 ? 'silver' : rank === 3 ? 'bronze' : '';
            const pct = Math.max(4, Math.round((item.periodTime / maxTime) * 100));
            const icon = item.favicon || "";

            const li = document.createElement("li");
            li.className = "list-item";
            if (rank <= 3) li.dataset.rank = rank;

            li.innerHTML = `
                <div class="item-favicon-wrapper">
                    ${icon ? `<img src="${icon}" class="item-favicon" alt="">` : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>`}
                    ${rankClass ? `<div class="rank-badge ${rankClass}">${rank}</div>` : ''}
                </div>
                <div class="item-content">
                    <div class="item-title" title="${item.url}">${item.title || item.url}</div>
                    <div class="item-time-row">
                        <div class="item-time">
                            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                            ${formatTime(item.periodTime)}
                        </div>
                        <div class="time-bar-wrap">
                            <div class="time-bar" style="width: ${pct}%"></div>
                        </div>
                    </div>
                </div>
                <div class="item-actions">
                    <button class="icon-btn ${item.pinned ? 'active' : ''}" data-tooltip="${item.pinned ? 'Unpin' : 'Pin'}" data-action="pin">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="${item.pinned ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
                    </button>
                    <button class="icon-btn danger" data-tooltip="Clear data" data-action="delete-usage">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                    </button>
                    <button class="icon-btn danger" data-tooltip="Close tab" data-action="close">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                </div>
            `;

            const faviconImg1 = li.querySelector(".item-favicon");
            if (faviconImg1) faviconImg1.addEventListener("error", () => { faviconImg1.style.display = "none"; });

            li.querySelector(".item-content").addEventListener("click", () => {
                chrome.tabs.update(item.tabId, { active: true });
                const t = tabs.find(x => x.id === item.tabId);
                if (t) chrome.windows.update(t.windowId, { focused: true });
            });

            li.querySelector('[data-action="pin"]').onclick = async (e) => {
                e.stopPropagation();
                await chrome.tabs.update(item.tabId, { pinned: !item.pinned });
                refreshUI();
            };

            li.querySelector('[data-action="delete-usage"]').onclick = async (e) => {
                e.stopPropagation();
                if (confirm(`Clear usage data for "${item.title || item.url}"?`)) {
                    delete tracker[item.url];
                    await chrome.storage.local.set({ [TIME_STORAGE_KEY]: tracker });
                    refreshUI();
                }
            };

            li.querySelector('[data-action="close"]').onclick = async (e) => {
                e.stopPropagation();
                await chrome.tabs.remove(item.tabId);
                delete tracker[item.url];
                await chrome.storage.local.set({ [TIME_STORAGE_KEY]: tracker });
                await checkDuplicates();
                refreshUI();
            };

            topTabsList.appendChild(li);
        });
    }

    // ── STATS & GRAPHS ────────────────────────────────────
    statsPeriodBtns.forEach(btn => {
        btn.addEventListener("click", () => {
            statsPeriodBtns.forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            statsPeriod = btn.dataset.period;
            renderStats();
        });
    });

    async function renderStats() {
        const storage = await chrome.storage.local.get([TIME_STORAGE_KEY]);
        const tracker = storage[TIME_STORAGE_KEY] || {};

        let labels = [], dataPoints = [];
        const now   = new Date();
        let chartType = 'bar';

        if (statsPeriod === 'today') {
            const dateStr   = getDateStr(now);
            const todayStats = [];
            Object.entries(tracker).forEach(([url, tab]) => {
                if (tab.dailyTime && tab.dailyTime[dateStr]) {
                    todayStats.push({ title: tab.title || url, time: tab.dailyTime[dateStr] });
                }
            });
            todayStats.sort((a, b) => b.time - a.time);
            const top5 = todayStats.slice(0, 5);
            labels     = top5.map(i => i.title.length > 14 ? i.title.substring(0, 13) + '…' : i.title);
            dataPoints = top5.map(i => +(i.time / 60000).toFixed(1));
            if (!labels.length) { labels = ['No usage yet']; dataPoints = [0]; }

        } else if (statsPeriod === 'daily') {
            chartType = 'line';
            for (let i = 6; i >= 0; i--) {
                const date    = new Date(now);
                date.setDate(date.getDate() - i);
                const dateStr = getDateStr(date);
                labels.push(date.toLocaleDateString(undefined, { weekday: 'short' }));
                let dayTotal  = 0;
                Object.values(tracker).forEach(tab => {
                    if (tab.dailyTime && tab.dailyTime[dateStr]) dayTotal += tab.dailyTime[dateStr];
                });
                dataPoints.push(+(dayTotal / 60000).toFixed(1));
            }
        } else {
            chartType = 'bar';
            for (let i = 3; i >= 0; i--) {
                labels.push(i === 0 ? 'This week' : `${i}w ago`);
                let weekTotal = 0;
                for (let j = 0; j < 7; j++) {
                    const date    = new Date(now);
                    date.setDate(date.getDate() - (i * 7 + j));
                    const dateStr = getDateStr(date);
                    Object.values(tracker).forEach(tab => {
                        if (tab.dailyTime && tab.dailyTime[dateStr]) weekTotal += tab.dailyTime[dateStr];
                    });
                }
                dataPoints.push(+(weekTotal / 3600000).toFixed(2));
            }
        }

        const ctx = document.getElementById('usageChart').getContext('2d');
        if (currentUsageChart) currentUsageChart.destroy();

        const unitLabel = statsPeriod === 'weekly' ? 'Hours' : 'Minutes';
        const gradient  = ctx.createLinearGradient(0, 0, 0, 155);
        gradient.addColorStop(0, 'rgba(124,94,245,0.5)');
        gradient.addColorStop(1, 'rgba(79,138,245,0.03)');

        currentUsageChart = new Chart(ctx, {
            type: chartType,
            data: {
                labels,
                datasets: [{
                    label: unitLabel,
                    data: dataPoints,
                    borderColor:          'rgba(160,130,255,0.9)',
                    backgroundColor:      chartType === 'bar' ? 'rgba(124,94,245,0.7)' : gradient,
                    borderWidth:          chartType === 'bar' ? 0 : 2,
                    borderRadius:         chartType === 'bar' ? 5 : 0,
                    tension:              0.45,
                    fill:                 chartType !== 'bar',
                    pointBackgroundColor: '#a082ff',
                    pointRadius:          chartType === 'bar' ? 0 : 3,
                    pointHoverRadius:     5,
                    hoverBackgroundColor: 'rgba(160,130,255,0.9)'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: { duration: 400, easing: 'easeOutQuart' },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: 'rgba(13,13,26,0.95)',
                        borderColor:     'rgba(124,94,245,0.3)',
                        borderWidth:     1,
                        titleColor:      'rgba(220,220,255,0.9)',
                        bodyColor:       'rgba(180,180,220,0.8)',
                        padding:         8,
                        cornerRadius:    8,
                        mode:            'index',
                        intersect:       false,
                        callbacks: {
                            label: ctx => ` ${ctx.parsed.y.toFixed(1)} ${unitLabel.toLowerCase()}`
                        }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        grid:  { color: 'rgba(255,255,255,0.04)', drawBorder: false },
                        ticks: { color: 'rgba(180,180,220,0.5)', font: { size: 9 } }
                    },
                    x: {
                        grid:  { display: false },
                        ticks: { color: 'rgba(180,180,220,0.5)', font: { size: 9 } }
                    }
                }
            }
        });
    }

    // ── SAVED TABS ────────────────────────────────────────
    async function renderSavedTabs(query = "") {
        savedTabsList.innerHTML = "";
        const storage   = await chrome.storage.local.get([SAVED_TABS_KEY]);
        const savedTabs = storage[SAVED_TABS_KEY] || [];

        const filtered = savedTabs
            .filter(item => {
                const q = query.toLowerCase();
                return (item.title && item.title.toLowerCase().includes(q)) ||
                       (item.url   && item.url.toLowerCase().includes(q))   ||
                       (item.note  && item.note.toLowerCase().includes(q));
            })
            .sort((a, b) => b.savedAt - a.savedAt);

        if (filtered.length === 0) {
            savedTabsList.innerHTML = `
                <li class="empty-state">
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
                    <p>${query ? 'No results found' : 'No saved tabs yet'}</p>
                    <span>${query ? 'Try a different search' : 'Save a tab using the form above'}</span>
                </li>`;
            return;
        }

        filtered.forEach(item => {
            const li   = document.createElement("li");
            li.className = "list-item";
            const icon = item.favicon || "";
            li.innerHTML = `
                <div class="item-favicon-wrapper">
                    ${icon ? `<img src="${icon}" class="item-favicon" alt="">` : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>`}
                </div>
                <div class="item-content">
                    <div class="item-title" title="${item.url}">${item.title || item.url}</div>
                    ${item.note ? `<div class="item-note">${item.note}</div>` : ''}
                    <div class="item-meta">${new Date(item.savedAt).toLocaleDateString()}</div>
                </div>
                <div class="item-actions">
                    <button class="icon-btn danger" data-tooltip="Delete" data-action="delete">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                    </button>
                </div>
            `;

            const faviconImg2 = li.querySelector(".item-favicon");
            if (faviconImg2) faviconImg2.addEventListener("error", () => { faviconImg2.style.display = "none"; });

            li.querySelector(".item-content").onclick = () => chrome.tabs.create({ url: item.url });

            li.querySelector('[data-action="delete"]').onclick = async (e) => {
                e.stopPropagation();
                const fresh = (await chrome.storage.local.get([SAVED_TABS_KEY]))[SAVED_TABS_KEY] || [];
                const idx   = fresh.findIndex(t => t.savedAt === item.savedAt);
                if (idx !== -1) {
                    fresh.splice(idx, 1);
                    await chrome.storage.local.set({ [SAVED_TABS_KEY]: fresh });
                    renderSavedTabs(query);
                }
            };

            savedTabsList.appendChild(li);
        });
    }

    // ── SLEEP LOGS ────────────────────────────────────────
    async function renderSleepLogs() {
        sleepLogsList.innerHTML = "";
        const storage = await chrome.storage.local.get([SLEEP_LOGS_KEY]);
        const logs    = storage[SLEEP_LOGS_KEY] || [];

        if (logs.length === 0) {
            sleepLogsList.innerHTML = `
                <li class="empty-state">
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
                    <p>No sleep logs yet</p>
                    <span>Inactive tabs will appear here</span>
                </li>`;
            return;
        }

        logs.forEach(log => {
            const li        = document.createElement("li");
            li.className    = "list-item";
            li.style.cssText = "flex-direction:column;align-items:flex-start;";
            li.innerHTML = `
                <div class="log-timestamp">${new Date(log.timestamp).toLocaleString()}</div>
                <div style="font-size:.78rem;font-weight:700;margin:3px 0;color:var(--text)">Moved ${log.count} tab${log.count !== 1 ? 's' : ''} to sleep</div>
                <div class="log-details">
                    ${log.titles.slice(0, 3).map(t => `<span class="log-tab-title">· ${t}</span>`).join('')}
                    ${log.titles.length > 3 ? `<span class="log-tab-title" style="opacity:.5">…and ${log.titles.length - 3} more</span>` : ''}
                </div>
            `;
            sleepLogsList.appendChild(li);
        });
    }

    // ── HEADER TAB COUNT ──────────────────────────────────
    async function updateHeaderCount() {
        const tabs = await chrome.tabs.query({ currentWindow: true });
        headerTabCount.textContent = `${tabs.length} tab${tabs.length !== 1 ? 's' : ''}`;
    }

    // ── ACTIONS ───────────────────────────────────────────
    saveTabBtn.addEventListener("click", async () => {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab && tab.url) {
            const newItem = {
                url: tab.url, title: tab.title,
                favicon: tab.favIconUrl,
                note: tabNoteInput.value.trim(),
                savedAt: Date.now()
            };
            const storage   = await chrome.storage.local.get([SAVED_TABS_KEY]);
            const savedTabs = storage[SAVED_TABS_KEY] || [];
            savedTabs.push(newItem);
            await chrome.storage.local.set({ [SAVED_TABS_KEY]: savedTabs });
            tabNoteInput.value = "";
            chrome.tabs.remove(tab.id);
            renderSavedTabs();
        }
    });

    manualSleepBtn.addEventListener("click", async () => {
        manualSleepBtn.disabled = true;
        manualSleepBtn.innerHTML = `<svg class="spinner" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> Moving…`;
        chrome.runtime.sendMessage({ action: "manualSleep" }, () => {
            setTimeout(() => {
                manualSleepBtn.disabled = false;
                manualSleepBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg> Sleep Inactive`;
                refreshUI();
            }, 1000);
        });
    });

    searchTopInput.addEventListener("input",   e => renderTopTabs(e.target.value));
    searchSavedInput.addEventListener("input", e => renderSavedTabs(e.target.value));

    // ── REFRESH ───────────────────────────────────────────
    function refreshUI() {
        updateHeaderCount();
        renderTopTabs(searchTopInput.value);
        renderSavedTabs(searchSavedInput.value);
        renderSleepLogs();
        if (document.querySelector('.tab-btn[data-tab="stats"]').classList.contains('active')) {
            renderStats();
        }
    }

    // ── INIT ──────────────────────────────────────────────
    chrome.runtime.sendMessage({ action: "syncTime" }, async () => {
        await checkDuplicates();
        refreshUI();
    });
    setInterval(refreshUI, 15000);
});
