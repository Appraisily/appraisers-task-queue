/**
 * Build script for appraisers-task-queue
 * 
 * This script:
 * 1. Checks all JS files for syntax errors
 * 2. Verifies that required modules are installed
 * 3. Makes sure no Pub/Sub code remains in the project
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Colors for terminal output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m'
};

// List of module imports that should NOT be in the codebase
const forbiddenModules = [
  '@google-cloud/pubsub'
];

// Files to check for forbidden code patterns
const codePatterns = [
  { pattern: /PubSub|pubsub|Pub\/Sub|pub-sub/i, message: 'Pub/Sub code found' }
];

let foundErrors = false;

/**
 * Print a formatted message to console
 */
function log(message, color = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

/**
 * Check a file for syntax errors
 */
function checkSyntax(filePath) {
  try {
    execSync(`node -c "${filePath}"`, { stdio: 'pipe' });
    log(`✓ Syntax check passed: ${filePath}`, colors.green);
    return true;
  } catch (error) {
    log(`✗ Syntax error in ${filePath}:`, colors.red);
    log(`  ${error.message}`, colors.red);
    foundErrors = true;
    return false;
  }
}

/**
 * Check file content for forbidden patterns
 */
function checkFileContent(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    
    // Check for forbidden module imports
    if (/require\s*\(\s*['"]([^'"]+)['"]\s*\)/.test(content)) {
      const imports = content.match(/require\s*\(\s*['"]([^'"]+)['"]\s*\)/g) || [];
      imports.forEach(importStatement => {
        const moduleName = importStatement.match(/require\s*\(\s*['"]([^'"]+)['"]\s*\)/)[1];
        
        if (forbiddenModules.some(forbidden => moduleName.includes(forbidden))) {
          log(`✗ Forbidden module import in ${filePath}: ${moduleName}`, colors.red);
          foundErrors = true;
        }
      });
    }
    
    // Check for other forbidden code patterns
    codePatterns.forEach(({ pattern, message }) => {
      if (pattern.test(content)) {
        log(`✗ ${message} in ${filePath}`, colors.red);
        foundErrors = true;
      }
    });
    
    return !foundErrors;
  } catch (error) {
    log(`✗ Error checking file content for ${filePath}: ${error.message}`, colors.red);
    foundErrors = true;
    return false;
  }
}

/**
 * Process all JavaScript files in a directory recursively
 */
function processDirectory(dir) {
  const items = fs.readdirSync(dir, { withFileTypes: true });
  
  items.forEach(item => {
    const itemPath = path.join(dir, item.name);
    
    if (item.isDirectory() && !item.name.startsWith('node_modules')) {
      // Recursively process subdirectories
      processDirectory(itemPath);
    } else if (item.name.endsWith('.js')) {
      // Check JavaScript files
      checkSyntax(itemPath);
      checkFileContent(itemPath);
    }
  });
}

/**
 * Main build function
 */
function build() {
  log('\n🔨 Building appraisers-task-queue\n', colors.cyan);
  
  try {
    // Check package.json
    log('Checking package.json...', colors.cyan);
    const packageJson = require('../package.json');
    
    // Check dependencies for forbidden modules
    if (packageJson.dependencies) {
      Object.keys(packageJson.dependencies).forEach(dep => {
        if (forbiddenModules.includes(dep)) {
          log(`✗ Forbidden dependency in package.json: ${dep}`, colors.red);
          foundErrors = true;
        }
      });
    }
    
    // Process all directories
    log('\nChecking source files...', colors.cyan);
    processDirectory(path.join(__dirname, '..', 'src'));
    
    // Check for Pub/Sub related files
    const rootFiles = fs.readdirSync(path.join(__dirname, '..'));
    const pubsubFiles = rootFiles.filter(file => 
      file.includes('processor') || file.includes('pubsub')
    );
    
    if (pubsubFiles.length > 0) {
      log(`\n✗ Potential Pub/Sub related files found in root directory:`, colors.red);
      pubsubFiles.forEach(file => {
        log(`  - ${file}`, colors.red);
      });
      foundErrors = true;
    }
    
    // Summary
    if (foundErrors) {
      log('\n❌ Build failed with errors', colors.red);
      process.exit(1);
    } else {
      log('\n✅ Build successful - All checks passed', colors.green);
    }
  } catch (error) {
    log(`\n❌ Build failed: ${error.message}`, colors.red);
    process.exit(1);
  }
}

// Run the build
build(); 