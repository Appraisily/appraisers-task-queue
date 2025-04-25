# Appraisers Task Queue Service

A microservice responsible for processing appraisal tasks asynchronously through direct service calls.

## Architecture Overview

The appraisal system follows a microservices architecture with the following components:

1. **Appraisers Frontend**: User interface for customers and administrators
2. **Appraisers Backend**: API gateway and data service
3. **Appraisers Task Queue**: Asynchronous processing service (this repository)

### Service Responsibilities

```
┌─────────────────────┐        ┌─────────────────────┐        ┌─────────────────────┐
│                     │        │                     │  HTTP  │                     │
│  Appraisers         │  HTTP  │  Appraisers         │───────►│  Appraisers         │
│  Frontend           │───────►│  Backend            │◄───────│  Task Queue         │
│                     │◄───────│                     │        │                     │
│                     │        │                     │        │                     │
└─────────────────────┘        └─────────────────────┘        └─────────────────────┘
                                        │                              │
                                        │                              │
                                        ▼                              ▼
                               ┌─────────────────────┐       ┌─────────────────────┐
                               │                     │       │                     │
                               │  Database           │       │  External Services  │
                               │  (Google Sheets)    │       │  (OpenAI, etc.)     │
                               │                     │       │                     │
                               └─────────────────────┘       └─────────────────────┘
```

#### Appraisers Backend Responsibilities
- User authentication and authorization
- Serving data to the frontend
- Routing appraisal processing requests to Task Queue
- Storing and retrieving data from the database
- REST API endpoint management

#### Appraisers Task Queue Responsibilities
- Processing appraisals asynchronously
- Step-by-step orchestration of the appraisal workflow
- Integration with external services (OpenAI, WordPress, etc.)
- File generation (PDF reports)
- Email notifications
- Error handling and retry logic

## Appraisal Processing Flow

The appraisal processing follows a step-by-step workflow:

```
┌─────────────────┐
│ User triggers   │
│ appraisal       │
│ processing      │
└────────┬────────┘
         │
         ▼
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│ Backend routes  │     │ Task Queue      │     │ Task Queue      │
│ request to      │────►│ receives        │────►│ processes       │
│ Task Queue      │     │ HTTP request    │     │ appraisal       │
└─────────────────┘     └─────────────────┘     └────────┬────────┘
                                                         │
                                                         ▼
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│ Task Queue      │     │ Task Queue      │     │ Task Queue      │
│ updates status  │◄────│ generates       │◄────│ merges          │
│ in database     │     │ reports & PDFs  │     │ descriptions    │
└────────┬────────┘     └─────────────────┘     └─────────────────┘
         │
         ▼
┌─────────────────┐
│ Backend serves  │
│ updated status  │
│ to Frontend     │
└─────────────────┘
```

### Appraisal Processing Steps

1. **STEP_SET_VALUE**: Set the appraisal value and store initial description
2. **STEP_MERGE_DESCRIPTIONS**: Combine customer and AI-generated descriptions
3. **STEP_UPDATE_WORDPRESS**: Update the WordPress post with metadata
4. **STEP_GENERATE_VISUALIZATION**: Create charts and visualizations
5. **STEP_BUILD_REPORT**: Build the complete appraisal report
6. **STEP_GENERATE_PDF**: Create the PDF document and send email notification

## Image Analysis and Description Merging

A specialized endpoint is available for AI image analysis and description merging:

```
┌─────────────────┐
│ Backend sends   │
│ image analysis  │
│ request         │
└────────┬────────┘
         │
         ▼
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│ Task Queue      │     │ Task Queue      │     │ Task Queue      │
│ fetches image   │────►│ sends to GPT-4o │────►│ gets AI image   │
│ from WordPress  │     │ for analysis    │     │ description     │
└─────────────────┘     └─────────────────┘     └────────┬────────┘
                                                         │
                                                         ▼
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│ Backend gets    │     │ Task Queue      │     │ Task Queue      │
│ merged result   │◄────│ returns merged  │◄────│ merges all      │
│ with metadata   │     │ descriptions    │     │ descriptions    │
└─────────────────┘     └─────────────────┘     └─────────────────┘
```

This specialized flow handles:
1. Retrieving the main image from WordPress
2. Analyzing the image using GPT-4o
3. Extracting expert descriptions from the AI
4. Merging with customer-provided descriptions
5. Extracting structured metadata
6. Storing all results in Google Sheets

## Important Implementation Notes

### 1. Processing Responsibility

**IMPORTANT**: The Appraisers Backend should NEVER execute appraisal processing steps directly. All processing must be delegated to the Task Queue service.

The backend's responsibility is limited to:
- Receiving requests from the frontend
- Validating request parameters
- Forwarding requests to the Task Queue service
- Returning success/failure responses to the frontend

The Task Queue service is responsible for:
- Executing all appraisal processing steps
- Handling errors
- Updating the appraisal status
- Generating files and sending notifications

### 2. Step-by-Step Processing

The system supports processing appraisals from specific steps. This is useful for:
- Reprocessing failed steps
- Manually triggering specific parts of the workflow
- Testing individual steps

To process from a specific step, the backend sends a request to the Task Queue service with:
- Appraisal ID
- Starting step
- Any additional options required

## API Endpoints

### Task Queue Service

- **GET /health**: Health check endpoint
- **GET /api/docs**: API documentation
- **POST /api/process-step**: Process an appraisal from a specific step
- **POST /api/analyze-image-and-merge**: Analyze an image with GPT-4o and merge descriptions

### Endpoint Details

#### POST /api/analyze-image-and-merge

Specialized endpoint for AI image analysis and description merging.

```json
// Request
{
  "id": "140",              // Appraisal ID (row in spreadsheet)
  "postId": "145911",       // WordPress post ID with main image
  "description": "...",     // Optional customer description
  "options": {}             // Additional options (optional)
}

// Response
{
  "success": true,
  "message": "Image analyzed and descriptions merged for appraisal 140",
  "data": {
    "appraisalId": "140",
    "postId": "145911",
    "aiImageDescription": "...",
    "customerDescription": "...",
    "mergedDescription": "...",
    "briefTitle": "Oil Painting of Countryside",
    "detailedTitle": "19th Century European Oil Painting of Rural Countryside",
    "metadata": {
      "object_type": "Oil Painting",
      "creator": "Unknown",
      "estimated_age": "Mid-19th Century",
      "medium": "Oil on Canvas",
      "condition_summary": "Good condition with minor craquelure"
    }
  },
  "timestamp": "2025-04-25T09:30:15.123Z"
}
```

## Development

### Prerequisites

- Node.js 16+
- Google Cloud SDK
- Access to Google Secret Manager

### Environment Setup

The following environment variables need to be available through Google Secret Manager:

- `PENDING_APPRAISALS_SPREADSHEET_ID`: Google Sheets spreadsheet ID
- `OPENAI_API_KEY`: OpenAI API key
- Other service-specific secrets

### Running Locally

```bash
npm install
npm start
```

### Deployment

The service is deployed to Google Cloud Run using the provided cloudbuild.yaml configuration.

```bash
gcloud builds submit --config cloudbuild.yaml
```

## Error Handling

Errors during processing are:
1. Logged for debugging
2. Reflected in the appraisal status with detailed error messages

## Monitoring

The service includes logging for all major operations and errors. Logs are available in Google Cloud Logging.