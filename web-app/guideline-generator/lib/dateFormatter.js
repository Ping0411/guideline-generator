/**
 * dateFormatter.js
 *
 * Formats today's date as "Mon D, YYYY" (e.g. "Aug 5, 2026").
 */

function formatTodayForVersionHistory() {
  const now = new Date();
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const month = months[now.getMonth()];
  const day = now.getDate();
  const year = now.getFullYear();
  return `${month} ${day}, ${year}`;
}

module.exports = { formatTodayForVersionHistory };
