// shared.js - Shared utilities for Manureva AI Assistant
// Single source of truth for cross-component functions.
// Loaded by: background.js (importScripts), sidepanel.html (script tag),
//            content.js (programmatic injection via chrome.scripting.executeScript)

function detectPlatform(url) {
  if (!url) return 'unknown';
  if (/atlassian\.net|jira\./i.test(url)) return 'jira';
  if (/\/wp-admin|\/wp-login/i.test(url)) return 'wordpress-admin';
  if (/wordpress|developer\.wordpress/i.test(url)) return 'wordpress';
  if (/github\.com/i.test(url)) return 'github';
  if (/elegantthemes|divi/i.test(url)) return 'divi';
  return 'website';
}
