# Appraisers Task Queue Service

A microservice responsible for processing appraisal tasks asynchronously using Google Pub/Sub.

## Architecture Overview

The appraisal system follows a microservices architecture with the following components:

1. **Appraisers Frontend**: User interface for customers and administrators
2. **Appraisers Backend**: API gateway and data service
3. **Appraisers Task Queue**: Asynchronous processing service (this repository)

### Service Responsibilities

```
┌─────────────────────┐        ┌─────────────────────┐        ┌─────────────────────┐
│                     │        │                     │        │                     │
│  Appraisers         │  HTTP  │  Appraisers         │  PubSub│  Appraisers         │
│  Frontend           │───────►│  Backend            │───────►│  Task Queue         │
│                     │◄───────│                     │◄───────│                     │
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
│ Task Queue      │     │ message         │     │ appraisal       │
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

1. **SET_VALUE**: Set the appraisal value and store initial description
2. **MERGE_DESCRIPTIONS**: Combine customer and AI-generated descriptions
3. **GET_TYPE**: Determine the appraisal type (Regular, IRS, Insurance)
4. **UPDATE_WORDPRESS**: Update the WordPress post with metadata
5. **FETCH_VALUER_DATA**: Get additional data from external valuation sources
6. **GENERATE_VISUALIZATION**: Create charts and visualizations
7. **BUILD_REPORT**: Generate the HTML report
8. **GENERATE_PDF**: Create the PDF document
9. **SEND_EMAIL**: Send notification email to customer
10. **COMPLETE**: Mark appraisal as completed

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
- Handling errors and retries
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

## Development

### Prerequisites

- Node.js 18+
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
npm run dev
```

### Deployment

The service is deployed to Google Cloud Run using the provided cloudbuild.yaml configuration.

```bash
gcloud builds submit --config cloudbuild.yaml
```

## Error Handling

Errors during processing are:
1. Logged for debugging
2. Published to a Dead Letter Queue (DLQ) topic
3. Reflected in the appraisal status

## Monitoring

The service includes logging for all major operations and errors. Logs are available in Google Cloud Logging.