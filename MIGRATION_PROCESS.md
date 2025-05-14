# Appraisal Migration Process

This document outlines the process for migrating old appraisals to the new format using a dedicated endpoint in the Appraisers Task Queue service.

## Migration Endpoint Overview

The migration endpoint will extract data from an existing appraisal URL and convert it to the format required for processing as a new appraisal.

```mermaid
flowchart TD
    A[HTTP POST /api/migrate-appraisal] --> B{Request Validation};
    B -- Valid --> C[Fetch Content from Appraisal URL];
    B -- Invalid --> D[Return 400 Error];
    C --> E[Extract Metadata & Images];
    E --> F[Process with Gemini 2.5 Pro];
    F --> G[Structure Response JSON];
    G --> H[Return 200 Success with Migration Data];
    C -- Error --> I[Log Error & Return 500 Error];
    E -- Error --> I;
    F -- Error --> I;
</flowchart>
```

## Service Reuse Approach

**IMPORTANT**: This implementation will strictly reuse existing services without modifying their interfaces or behavior to ensure current endpoints continue to function without disruption.

1. **Zero Modifications to Existing Code**:
   - No changes to existing service interfaces
   - No modifications to current method signatures
   - No alterations to existing workflows

2. **Composition Over Modification**:
   - The new endpoint will compose existing services rather than modify them
   - Where necessary, adapter patterns will be used to bridge interfaces
   - All new functionality will be implemented in dedicated modules

3. **Service Reuse Strategy**:
   - `wordpressService`: Reuse for fetching images and content (read-only operations)
   - `openaiService`: Reuse for AI processing pattern, extend with new method
   - `sheetsService`: Reuse for data access patterns
   - `logger`: Reuse for consistent logging

## Detailed Process Flow

### 1. Request Handling

The API will expose a new endpoint: `/api/migrate-appraisal` which accepts a POST request with the following parameters:
- `url`: The URL of the existing appraisal to migrate (required)
- `sessionId`: The session ID for the new appraisal process (required)
- `customerEmail`: The customer's email address (required)
- `options`: Additional options for processing (optional)

Example request:
```json
{
  "url": "https://resources.appraisily.com/appraisals/an-original-limited-edition-signed-by-listed-artist-johnny-friedlaender-haarlem-active-mid-late-20thc-circa-1976-lithography-made-as-ad-poster-for-museum-frans-hals-in-haarlem-depicting-an-abstract/",
  "sessionId": "abcd1234",
  "customerEmail": "customer@example.com",
  "options": {
    "forceRefresh": true
  }
}
```

### 2. Content Extraction

Once the request is validated, the service will:

1. Fetch the HTML content from the provided URL
   - Reuse existing HTTP utilities but in a read-only capacity
2. Parse the DOM to extract:
   - Main appraisal image (highest resolution version)
   - Age verification image (if available)
   - Signature image (if available)
   - Appraisal value and currency
   - Appraiser's description (professional description)
   - Original customer description
   - Any AI-generated description
   - All metadata fields (dimensions, materials, age, etc.)

### 3. AI Processing with Gemini 2.5 Pro

After extracting the raw content, the service will:

1. Prepare a prompt for Gemini 2.5 Pro with all extracted content
   - Implement in a new dedicated service method without modifying existing OpenAI service
2. Request Gemini to analyze and structure the data
3. Specifically ask Gemini to:
   - Identify the most important details from all descriptions
   - Create a structured representation of the item
   - Identify contradictions between descriptions and resolve them
   - Format everything in a consistent manner suitable for the new appraisal format

### 4. Response Structuring

The endpoint will return a structured JSON response containing:

```json
{
  "success": true,
  "message": "Appraisal migration data prepared successfully",
  "data": {
    "sessionId": "abcd1234",
    "customerEmail": "customer@example.com",
    "migrationSource": "https://resources.appraisily.com/appraisals/...",
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
    "timestamp": "2025-04-25T09:30:15.123Z"
  }
}
```

## Implementation Considerations

### 1. Content Extraction Approach

The system will need to handle different HTML structures as the website design may have changed over time. Implementation options:

1. **Cheerio-based parsing**: Use a library like Cheerio to parse the HTML and extract content using CSS selectors
   - Implemented in a new dedicated service that doesn't modify existing code
2. **Playwright/Puppeteer**: Use a headless browser to load the page with JavaScript and extract dynamic content
3. **Combined approach**: Try Cheerio first, fall back to Puppeteer for complex pages

### 2. Image Handling

For each image (main, age verification, signature):

1. Extract the URL of the highest-resolution version
   - Reuse existing WordPress service for URL fetching only
2. Do not download images by default (return URLs in the response)
3. Optionally download if `options.downloadImages` is set to true
4. If images are downloaded, store them temporarily and include paths in the response

### 3. AI Processing Considerations

When working with Gemini 2.5 Pro:

1. Use a detailed system prompt explaining the task
2. Structure the prompt to clearly separate different content types
3. Include examples of desired output format
4. Implement robust error handling for cases where AI fails to generate proper output
5. Consider implementing fallback to GPT-4o if Gemini has issues
   - Reuse existing OpenAI service pattern but implement a new method without modifying existing code

### 4. Rate Limiting and Caching

To prevent abuse and optimize performance:

1. Implement rate limiting on the endpoint
   - Leverage existing patterns without modifying current implementation
2. Cache responses based on the URL to avoid redundant processing
3. Allow cache bypass with the `options.forceRefresh` flag
4. Implement timeouts for external requests

## Error Handling

The service will implement comprehensive error handling:

1. Invalid URL format: Return 400 with clear validation error
2. URL not accessible: Return 500 with "Unable to access URL" message
3. Content extraction failure: Return 500 with details on what failed
4. AI processing failure: Return 500 with specific AI error message
5. General processing errors: Log detailed error, return 500 with user-friendly message
   - Reuse existing error handling patterns and logging mechanisms

## Security Considerations

To ensure security:

1. Validate that the URL belongs to the appraisily.com domain
2. Sanitize all extracted content before processing
3. Implement timeouts to prevent hanging connections
4. Limit maximum content size to prevent memory issues
5. Validate the sessionId and customerEmail formats

## Implementation Structure

To ensure proper isolation and prevent breaking existing functionality:

1. **New Endpoint Registration**:
   - Add the new endpoint to `app.js` following existing patterns
   - Implement handler in `worker.js` as a standalone method

2. **New Service Components**:
   - `migrationService.js`: New service coordinating the migration process
   - `contentExtractionService.js`: New service for parsing appraisal URLs
   - `geminiService.js`: New service for Gemini 2.5 Pro integration

3. **Service Composition**:
   ```
   ┌─────────────────────┐
   │  migrationService   │
   └─────────┬───────────┘
             │
             │ composes
             ▼
   ┌─────────────────────┐  reuses   ┌─────────────────────┐
   │contentExtractionSvc │◄─────────►│   wordpressService  │
   └─────────────────────┘  read-only└─────────────────────┘
             │
             │ uses
             ▼
   ┌─────────────────────┐  follows  ┌─────────────────────┐
   │    geminiService    │◄─────────►│    openaiService    │
   └─────────────────────┘  pattern  └─────────────────────┘
   ```

## Integration with Existing Process

After obtaining the migration data, the frontend/backend can:

1. Use the data to populate the form for creating a new appraisal
2. Send the structured data to the regular appraisal creation endpoint
3. Process the appraisal through the standard flow, with the appropriate metadata
4. Maintain a reference to the original appraisal URL for tracking purposes 