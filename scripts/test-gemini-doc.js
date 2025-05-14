#!/usr/bin/env node

/**
 * Test script for generating Gemini-powered appraisal documents from WordPress posts
 * 
 * Usage:
 * node test-gemini-doc.js --post-id 12345 --format docs
 * node test-gemini-doc.js --post-id 12345 --format pdf --output appraisal.pdf
 * node test-gemini-doc.js --post-id 12345 --compare (compare with traditional generation)
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
  .option('-c, --compare', 'Compare with traditional generation', false)
  .option('-u, --api-url <url>', 'API endpoint URL', 'http://localhost:8080/api/generate-gemini-doc')
  .parse(process.argv);

const options = program.opts();

// Validate options
if (!options.postId) {
  console.error('Error: Post ID is required');
  program.help();
  process.exit(1);
}

// If output file is specified but format is not pdf, show warning
if (options.output && options.format !== 'pdf') {
  console.warn('Warning: Output file specified but format is not pdf. Setting format to pdf.');
  options.format = 'pdf';
}

// Run the test
async function runTest() {
  try {
    console.log(`\n=== Testing Gemini Document Generation ===`);
    console.log(`Post ID: ${options.postId}`);
    console.log(`Format: ${options.format}`);
    console.log(`API URL: ${options.apiUrl}`);
    
    // Determine the URL to fetch
    let url = `${options.apiUrl}/${options.postId}`;
    if (options.format) {
      url += `?format=${options.format}`;
    }
    
    console.log(`\nGenerating document...`);
    console.log(`Request URL: ${url}`);
    
    const startTime = Date.now();
    const response = await fetch(url);
    const endTime = Date.now();
    
    if (!response.ok) {
      let errorText;
      try {
        const errorData = await response.json();
        errorText = errorData.message || response.statusText;
      } catch (e) {
        errorText = await response.text() || response.statusText;
      }
      throw new Error(`API request failed: ${errorText}`);
    }
    
    if (options.format === 'pdf' && options.output) {
      // Save PDF to file
      const buffer = await response.buffer();
      fs.writeFileSync(path.resolve(options.output), buffer);
      console.log(`\n✓ Success! PDF saved to ${options.output}`);
    } else {
      // Display Google Docs URL
      const result = await response.json();
      console.log('\n✓ Success! Google Doc created:');
      console.log(`URL: ${result.docUrl}`);
      console.log(`ID: ${result.docId}`);
    }
    
    console.log(`\nProcessing time: ${(endTime - startTime)/1000} seconds`);
    
    // Compare with traditional generation if requested
    if (options.compare) {
      console.log(`\n=== Comparing with Traditional Document Generation ===`);
      
      const traditionalUrl = options.apiUrl.replace('generate-gemini-doc', 'generate-appraisal-doc');
      let compareUrl = `${traditionalUrl}/${options.postId}?format=${options.format}`;
      
      console.log(`Traditional API URL: ${compareUrl}`);
      
      const traditionalStartTime = Date.now();
      const traditionalResponse = await fetch(compareUrl);
      const traditionalEndTime = Date.now();
      
      if (!traditionalResponse.ok) {
        console.error(`Traditional generation failed: ${traditionalResponse.statusText}`);
      } else {
        if (options.format !== 'pdf') {
          const traditionalResult = await traditionalResponse.json();
          console.log('\n✓ Traditional Doc created:');
          console.log(`URL: ${traditionalResult.docUrl}`);
          console.log(`ID: ${traditionalResult.docId}`);
        } else {
          console.log('\n✓ Traditional PDF generated successfully');
        }
        
        console.log(`\nTraditional processing time: ${(traditionalEndTime - traditionalStartTime)/1000} seconds`);
        console.log(`\nComparison: Gemini ${(endTime - startTime)/1000}s vs Traditional ${(traditionalEndTime - traditionalStartTime)/1000}s`);
      }
    }
    
  } catch (error) {
    console.error(`\n✗ Error: ${error.message}`);
    process.exit(1);
  }
}

runTest(); 