#!/usr/bin/env node

/**
 * Test script for generating appraisal documents from WordPress posts
 * 
 * Usage:
 * node test-appraisal-doc.js --post-id 12345 --format docs
 * node test-appraisal-doc.js --post-id 12345 --format pdf --output appraisal.pdf
 */

const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const { program } = require('commander');

// Define CLI options
program
  .option('-p, --post-id <id>', 'WordPress post ID')
  .option('-f, --format <format>', 'Output format: docs or pdf', 'docs')
  .option('-o, --output <file>', 'Output file path (for PDF)')
  .option('-u, --api-url <url>', 'API endpoint URL', 'http://localhost:8080/api/generate-appraisal-doc')
  .parse(process.argv);

const options = program.opts();

async function runTest() {
  try {
    if (!options.postId) {
      console.error('Error: Post ID is required');
      program.help();
      return;
    }

    console.log(`Generating ${options.format} for WordPress post ID: ${options.postId}`);

    // Determine whether to use GET or POST
    let response;
    if (options.format === 'docs') {
      // Use GET for docs
      const url = `${options.apiUrl}/${options.postId}?format=docs`;
      response = await fetch(url);
    } else {
      // Use GET with format=pdf for PDF
      const url = `${options.apiUrl}/${options.postId}?format=pdf`;
      response = await fetch(url);
    }

    if (!response.ok) {
      throw new Error(`API request failed: ${response.statusText}`);
    }

    if (options.format === 'pdf') {
      // Handle PDF response
      const buffer = await response.buffer();
      
      // If output file is specified, save to file, otherwise save to default location
      const outputPath = options.output || `appraisal-${options.postId}.pdf`;
      fs.writeFileSync(path.resolve(outputPath), buffer);
      console.log(`PDF saved to ${outputPath}`);
    } else {
      // Handle Google Docs response
      const result = await response.json();
      console.log('Google Doc created:');
      console.log(`URL: ${result.docUrl}`);
      console.log(`ID: ${result.docId}`);
    }
  } catch (error) {
    console.error('Test failed:', error);
    process.exit(1);
  }
}

runTest(); 