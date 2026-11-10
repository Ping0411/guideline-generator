'use strict';

/**
 * test-format.js
 * Quick test: run formatCxml on a sample file and print the result to stdout.
 * Usage: node test-format.js <path-to-cxml-file>
 */

const fs = require('fs');
const { formatCxml } = require('./lib/cxmlFormatter');

const filePath = process.argv[2];
if (!filePath) {
  console.error('Usage: node test-format.js <path-to-cxml-file>');
  process.exit(1);
}

const content = fs.readFileSync(filePath, 'utf8');
const lines = formatCxml(content);

lines.forEach((line, i) => {
  console.log(`${String(i + 1).padStart(4, ' ')}: ${line.text}`);
});
