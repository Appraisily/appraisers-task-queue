# Appraisal Migration Feature

This document provides usage instructions for the new appraisal migration endpoint that extracts data from existing appraisals and converts it to the format required for processing as a new appraisal.

## Endpoint Usage

The migration endpoint is available at `/api/migrate-appraisal` and accepts POST requests with the following parameters:

```json
{
  "url": "https://resources.appraisily.com/appraisals/example-appraisal-url/",
  "sessionId": "unique-session-id",
  "customerEmail": "customer@example.com",
  "options": {
    "forceRefresh": true
  }
}
```

### Required Parameters

- `url`: The URL of the existing appraisal to migrate (must be from appraisily.com domain)
- `sessionId`: The session ID for the new appraisal process
- `customerEmail`: The customer's email address

### Optional Parameters

- `options`: Additional options for processing
  - `forceRefresh`: Force a refresh of cached data (default: false)

## Response Format

The endpoint returns a JSON response with the following structure:

```json
{
  "success": true,
  "message": "Appraisal migration data prepared successfully",
  "data": {
    "sessionId": "unique-session-id",
    "customerEmail": "customer@example.com",
    "migrationSource": "https://resources.appraisily.com/appraisals/example-appraisal-url/",
    "mainImage": {
      "url": "https://resources.appraisily.com/wp-content/uploads/...",
      "localPath": null
    },
    "ageImage": {
      "url": "https://resources.appraisily.com/wp-content/uploads/...",
      "localPath": null
    },
    "signatureImage": {
      "url": "https://resources.appraisily.com/wp-content/uploads/...",
      "localPath": null
    },
    "value": {
      "amount": 2500,
      "currency": "USD",
      "formatted": "$2,500"
    },
    "descriptions": {
      "appraiser": "Professional description extracted from the original appraisal...",
      "customer": "Original customer description...",
      "ai": "AI-generated description from the original appraisal..."
    },
    "metadata": {
      "title": "Original Limited Edition signed by Johnny Friedlaender",
      "detailedTitle": "An Original Limited Edition signed by listed artist Johnny Friedlaender, Haarlem (active mid-late 20thC), circa 1976, lithography made as ad poster for Museum Frans Hals in Haarlem depicting an abstract",
      "objectType": "Lithograph",
      "creator": "Johnny Friedlaender",
      "age": "Mid-late 20th Century, circa 1976",
      "materials": "Lithography, Poster",
      "dimensions": "Extracted dimensions...",
      "condition": "Extracted condition assessment...",
      "provenance": "Museum Frans Hals in Haarlem"
    },
    "mergedDescription": "Comprehensive merged description from all sources...",
    "timestamp": "2025-04-25T09:30:15.123Z"
  },
  "timestamp": "2025-04-25T09:30:15.123Z"
}
```

## Error Handling

The endpoint returns appropriate HTTP status codes for different error scenarios:

- `400 Bad Request`: Missing required parameters or invalid URL format
- `404 Not Found`: URL not accessible
- `500 Internal Server Error`: Content extraction failure, AI processing failure, or other errors

## Integration Example

Here's an example of how to integrate with the migration endpoint using JavaScript:

```javascript
async function migrateAppraisal(url, sessionId, customerEmail) {
  try {
    const response = await fetch('https://your-api-domain.com/api/migrate-appraisal', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        url,
        sessionId,
        customerEmail
      })
    });
    
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.message || 'Migration failed');
    }
    
    return await response.json();
  } catch (error) {
    console.error('Error migrating appraisal:', error);
    throw error;
  }
}

// Usage
migrateAppraisal(
  'https://resources.appraisily.com/appraisals/example-appraisal-url/',
  'unique-session-id',
  'customer@example.com'
)
  .then(result => {
    console.log('Migration successful:', result);
    // Use the data to populate the form for creating a new appraisal
  })
  .catch(error => {
    console.error('Migration failed:', error);
  });
```

## Security Considerations

The migration endpoint includes several security features:

1. URL validation to ensure only appraisily.com domains are processed
2. Input validation for all required parameters
3. Content sanitization to prevent XSS and injection attacks
4. Rate limiting to prevent abuse
5. Timeout mechanisms to prevent hanging connections

## Dependencies

This feature requires the following additional npm packages:

- `cheerio`: For HTML parsing
- `@google/generative-ai`: For AI processing with Gemini 2.5 Pro

These dependencies are included in the package.json file. 