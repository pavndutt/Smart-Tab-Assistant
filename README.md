# Smart Tab Assistant

**Smart Tab Assistant: Group, Clean, Analyze your tabs**

[Install from the Chrome Web Store!](https://chromewebstore.google.com/detail/smart-tab-assistant-group/epncaedbpifoehbkcehfgiejdhhpebai?authuser=0&hl=en)

Do you ever find yourself drowning in tabs? **Smart Tab Assistant** is here to help keep your browser fast, organized, and focused. It automatically tidies up your workspace, helps you identify which tabs are eating up your time, and lets you quickly stash tabs for later reading. 

## Features

- 💤 **Auto-Group Inactive Tabs**: Automatically tucks away tabs you haven't used recently into a collapsed tab group to save memory and clear visual clutter.
- 🧹 **Duplicate Tab Cleaner**: Quickly finds and closes duplicate tabs across your browser window with one click.
- ⏱️ **Active Time Tracking**: Accurately tracks how much time you are spending actively looking at specific tabs (with a highly accurate tracker that pauses when you turn away from your computer).
- 💾 **Save Tabs for Later**: Save interesting tabs in one place and attach custom notes to them—so you can safely close them without losing track of your thoughts.
- 📈 **Stats Dashboard**: Beautiful charts outlining your browsing habits today, over the week, and all-time.

## Installation

### Method 1: Chrome Web Store (Recommended)
This is the easiest way to get the latest updates installed automatically:
1. Visit the [Smart Tab Assistant Chrome Web Store Page](https://chromewebstore.google.com/detail/smart-tab-assistant-group/epncaedbpifoehbkcehfgiejdhhpebai?authuser=0&hl=en).
2. Click **Add to Chrome**.

### Method 2: Manual Installation (Developer Mode)
If you prefer to install it manually:
1. Clone or download this repository.
2. In Google Chrome, go to `chrome://extensions`.
3. Enable **Developer mode** in the top right corner.
4. Click **Load unpacked** and select the directory where you saved the repository.

## Permissions Required
- **tabs**: To read tab URLs for time tracking and duplicate detection.
- **tabGroups**: To automatically group inactive tabs into customized sleep groups.
- **storage**: To save your tracked time data, saved tabs, and sleep logs securely on your local device.
- **alarms**: To periodically check for and handle inactive tabs in the background.
- **idle**: To detect when you step away from your device so that time isn't incorrectly added to your active tab.

## Privacy
Your data is exclusively yours. All data collected by the extension (tracked time, sleep logs, saved tabs) is saved entirely via local Chrome storage and is never sent to any external servers.
