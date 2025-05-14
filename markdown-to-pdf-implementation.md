# Markdown to PDF Implementation Plan via Google Docs API

## Overview

This document outlines the implementation plan to enhance the appraisals-backend by creating:

1. A template-based Markdown generation process that:
   - Uses a master Markdown template with placeholders (e.g., {{appraisal_title}})
   - Fills placeholders with WordPress post data retrieved directly by post ID
   - Generates a complete Markdown document

2. A conversion process that:
   - Uploads the Markdown to Google Drive
   - Converts to Google Docs using the Drive API
   - Optionally exports as PDF
   - Returns either the Google Docs link or PDF file

3. A separate endpoint for testing without affecting the current implementation

## New Architecture

```
[WordPress Post ID] → [Fetch Post Data] → [Master MD Template] → [Template Engine] → [Filled MD File] →
[Drive API: Upload MD] → [Convert to Doc] → [Optional: Export as PDF] → [Return Doc URL or PDF]
```

## Implementation Steps

### 1. Set Up Master Template System

1. Store the master Markdown template in a dedicated location
2. Create a template engine service to process placeholders
3. Add a data mapping layer to connect WordPress fields to template variables

```javascript
// Example template processing function
function processTemplate(template, data) {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    return data[key] || match; // Keep placeholder if data not available
  });
}
```

### 2. Add Google Workspace API Dependencies

```bash
npm install googleapis @google-cloud/local-auth handlebars
```

### 3. Configure Google API Authentication

Set up service account authentication for headless server operation:

- Create a service account in Google Cloud Console
- Grant it appropriate Drive API permissions
- Download the service account key file
- Store securely in environment/secrets

### 4. Create a WordPress Data Service

```javascript
// Service to fetch WordPress post data based on post ID or other criteria
async function getWordPressPostData(postId) {
  // Reuse existing WordPress API integration code
  const { wpApiUrl, wpCredentials } = await getWordPressConfig();
  
  const response = await fetch(`${wpApiUrl}/posts/${postId}?_embed=true`, {
    headers: {
      'Authorization': `Basic ${wpCredentials}`,
      'Accept': 'application/json'
    }
  });
  
  const post = await response.json();
  
  // Transform WordPress post data into template-compatible format
  return {
    appraisal_title: post.title.rendered,
    Introduction: post.content.rendered,
    appraisal_date: new Date().toLocaleDateString(),
    // Map all other required fields from WordPress data
    // This mapping should be comprehensive to cover all template variables
    ImageAnalysisText: post.meta.image_analysis || '',
    gallery: post.meta.gallery || '',
    // ... continue mapping all template variables
  };
}
```

### 5. Create a New Dedicated Endpoint

Create a new endpoint specifically for the template-to-docs-to-pdf flow that accepts a WordPress post ID directly:

```javascript
// Support both RESTful URL parameter and JSON body approaches for post ID
// POST /api/generate-appraisal-doc
// GET /api/generate-appraisal-doc/:postId
router.post('/generate-appraisal-doc', async (req, res) => {
  try {
    const { postId, outputFormat = 'docs' } = req.body; // 'docs' or 'pdf'
    
    if (!postId) {
      return res.status(400).json({ error: 'Post ID is required' });
    }
    
    // 1. Get WordPress data directly using the post ID
    const postData = await getWordPressPostData(postId);
    
    // 2. Get master template
    const templatePath = path.join(__dirname, '../templates/master-appraisal-template.md');
    const template = await fs.promises.readFile(templatePath, 'utf8');
    
    // 3. Fill template with data
    const filledMarkdown = processTemplate(template, postData);
    
    // 4. Convert to Google Docs and optionally PDF
    const result = await markdownToGoogleDoc(filledMarkdown, {
      filename: `Appraisal - ${postData.appraisal_title}`,
      convertToPdf: outputFormat === 'pdf'
    });
    
    // 5. Return appropriate response based on format
    if (outputFormat === 'pdf') {
      res.contentType('application/pdf');
      res.send(result.fileContent);
    } else {
      res.json({
        docUrl: result.docUrl,
        docId: result.docId,
        message: 'Google Doc created successfully'
      });
    }
  } catch (error) {
    console.error('Appraisal document generation failed:', error);
    res.status(500).json({ error: 'Failed to generate appraisal document' });
  }
});

// RESTful endpoint to get directly by ID in URL
router.get('/generate-appraisal-doc/:postId', async (req, res) => {
  try {
    const { postId } = req.params;
    const outputFormat = req.query.format || 'docs'; // Get format from query string
    
    // Same processing as POST endpoint
    const postData = await getWordPressPostData(postId);
    const templatePath = path.join(__dirname, '../templates/master-appraisal-template.md');
    const template = await fs.promises.readFile(templatePath, 'utf8');
    const filledMarkdown = processTemplate(template, postData);
    
    const result = await markdownToGoogleDoc(filledMarkdown, {
      filename: `Appraisal - ${postData.appraisal_title}`,
      convertToPdf: outputFormat === 'pdf'
    });
    
    if (outputFormat === 'pdf') {
      res.contentType('application/pdf');
      res.send(result.fileContent);
    } else {
      res.json({
        docUrl: result.docUrl,
        docId: result.docId,
        message: 'Google Doc created successfully'
      });
    }
  } catch (error) {
    console.error('Appraisal document generation failed:', error);
    res.status(500).json({ error: 'Failed to generate appraisal document' });
  }
});
```

### 6. Implement the Markdown to Google Docs Service

```javascript
const markdownToGoogleDoc = async (markdownContent, options = {}) => {
  try {
    // 1. Authorize with Google
    const authClient = await authorize();
    const drive = google.drive({ version: 'v3', auth: authClient });
    
    // 2. Prepare multipart request to upload Markdown and convert to Doc
    const requestBody = {
      name: options.filename || `Appraisal-${Date.now()}`,
      mimeType: 'text/markdown'
    };
    
    const media = {
      mimeType: 'text/markdown',
      body: markdownContent
    };
    
    // 3. Upload and convert to Google Doc
    const uploadResponse = await drive.files.create({
      requestBody,
      media,
      fields: 'id',
      supportsAllDrives: true,
      convert: true // This triggers conversion
    });
    
    const docId = uploadResponse.data.id;
    
    // Create a shareable link
    await drive.permissions.create({
      fileId: docId,
      requestBody: {
        role: 'reader',
        type: 'anyone'
      }
    });
    
    // Get the web view link
    const docResponse = await drive.files.get({
      fileId: docId,
      fields: 'webViewLink'
    });
    
    const docUrl = docResponse.data.webViewLink;
    
    // If PDF conversion is requested
    if (options.convertToPdf) {
      const pdfResponse = await drive.files.export({
        fileId: docId,
        mimeType: 'application/pdf'
      }, {
        responseType: 'arraybuffer'
      });
      
      // Return both the Doc URL and PDF content
      return {
        docId,
        docUrl,
        fileContent: Buffer.from(pdfResponse.data)
      };
    }
    
    // Return just the Doc URL if no PDF requested
    return {
      docId,
      docUrl
    };
    
  } catch (error) {
    console.error('Error converting Markdown to Google Doc:', error);
    throw error;
  }
};
```

### 7. Create a Simple Testing Interface

To test without a development environment, create a simple utility script with direct post ID support:

```javascript
// test-appraisal-doc.js
const { program } = require('commander');
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

program
  .option('-p, --post-id <id>', 'WordPress post ID')
  .option('-t, --template <file>', 'Path to Markdown template file')
  .option('-d, --data <file>', 'Path to JSON data file (alternative to post-id)')
  .option('-f, --format <format>', 'Output format: docs or pdf', 'docs')
  .option('-o, --output <file>', 'Output file path (for PDF)')
  .option('-u, --api-url <url>', 'API endpoint URL', 'http://localhost:3000/api/generate-appraisal-doc')
  .parse(process.argv);

const options = program.opts();

async function runTest() {
  try {
    // Simplest usage - just call the endpoint with a post ID
    if (options.postId) {
      console.log(`Fetching appraisal document for WordPress post ID: ${options.postId}`);
      
      // Use RESTful endpoint with ID in URL for GET requests
      let url = `${options.apiUrl}/${options.postId}`;
      if (options.format) {
        url += `?format=${options.format}`;
      }
      
      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error(`API request failed: ${response.statusText}`);
      }
      
      if (options.format === 'pdf' && options.output) {
        // Save PDF to file
        const buffer = await response.buffer();
        fs.writeFileSync(path.resolve(options.output), buffer);
        console.log(`PDF saved to ${options.output}`);
      } else {
        // Display Google Docs URL
        const result = await response.json();
        console.log('Google Doc created:');
        console.log(`URL: ${result.docUrl}`);
        console.log(`ID: ${result.docId}`);
      }
      return;
    }
    
    // Alternative approach using local files
    if (options.data && options.template) {
      // Use local template and data files
      const template = fs.readFileSync(path.resolve(options.template), 'utf8');
      const data = JSON.parse(fs.readFileSync(path.resolve(options.data), 'utf8'));
      
      const requestBody = {
        markdownContent: processTemplate(template, data),
        outputFormat: options.format
      };
      
      // Call the API
      const response = await fetch(options.apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      });
      
      if (!response.ok) {
        throw new Error(`API request failed: ${response.statusText}`);
      }
      
      // Process response same as above
      if (options.format === 'pdf' && options.output) {
        const buffer = await response.buffer();
        fs.writeFileSync(path.resolve(options.output), buffer);
        console.log(`PDF saved to ${options.output}`);
      } else {
        const result = await response.json();
        console.log('Google Doc created:');
        console.log(`URL: ${result.docUrl}`);
        console.log(`ID: ${result.docId}`);
      }
      return;
    }
    
    console.error('Error: Either provide a post-id or both template and data files');
    process.exit(1);
  } catch (error) {
    console.error('Test failed:', error);
  }
}

// Helper template processor
function processTemplate(template, data) {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    return data[key] || match;
  });
}

runTest();
```

## Rate Limiting and Performance Considerations

- Implement queuing for high-volume scenarios
- Cache frequently generated documents and templates
- Add retry logic for API failures
- Monitor Google API usage against quotas
- Store a local copy of the filled Markdown as a backup

## Storage and Retention Policy

- Store generated Markdown files in a dedicated storage location
- Set up a retention policy for temporary Google Docs
- Implement a cleanup job to delete unused documents periodically
- Keep a database record linking WordPress posts to generated Google Docs

## Security Considerations

- Sanitize WordPress data before filling templates
- Validate content length to avoid quota issues
- Ensure Google service account has minimal permissions
- Implement proper access controls for generated documents
- Set proper sharing permissions on Google Docs

## Testing Plan

1. Unit tests for the template processing system
2. Integration tests for WordPress data retrieval
3. End-to-end tests for the complete flow
4. Manual testing using the testing utility

## Rollout Plan

1. Implement as a separate endpoint initially
2. Add monitoring for Google API usage and errors
3. Test with a subset of WordPress posts
4. Gradually integrate with the main application

## Future Enhancements

- Add support for multiple templates (different appraisal types)
- Implement template versioning and history
- Create a visual template editor for non-technical users
- Add custom fonts and branding options for Google Docs
- Implement batch processing for multiple appraisals 