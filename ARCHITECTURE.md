# Appraisers System Architecture

This document outlines the architecture of the Appraisers system, focusing on the relationship between the backend and task queue components.

## System Components

The Appraisers system consists of three main components:

1. **Appraisers Frontend**: The user interface for customers and administrators
2. **Appraisers Backend**: The API gateway and data service 
3. **Appraisers Task Queue**: The asynchronous processing service

## Architectural Flow

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
                               │  Google Sheets      │       │  External Services  │
                               │  WordPress          │       │  (OpenAI, etc.)     │
                               │                     │       │                     │
                               └─────────────────────┘       └─────────────────────┘
```

## Key Responsibilities

### Appraisers Backend

The backend is responsible for:

- User authentication and authorization
- Serving data to the frontend
- **Routing appraisal processing requests to the Task Queue**
- Storing and retrieving data from databases
- API endpoint management

The backend should **never** perform appraisal processing directly. It should always forward processing requests to the Task Queue service.

### Appraisers Task Queue

The Task Queue is responsible for:

- Processing appraisals asynchronously
- Orchestrating the appraisal workflow
- Integration with external services (OpenAI, etc.)
- File generation (PDF reports)
- Email notifications

## Process Flow

1. The frontend sends a request to process an appraisal to the backend
2. The backend validates the request and forwards it to the Task Queue
3. The Task Queue processes the request asynchronously
4. The Task Queue updates the appraisal status in the database
5. The backend serves the updated status to the frontend

## Modified Endpoints

The following endpoints in the Appraisers Backend have been modified to forward requests to the Task Queue:

1. **POST /api/appraisals/:id/process-from-step**
   - Forwards step-by-step processing requests to the Task Queue

2. **POST /api/appraisals/:id/complete-process**
   - Forwards complete appraisal processing requests to the Task Queue

3. **POST /api/appraisals/:id/reprocess-step**
   - Forwards step reprocessing requests to the Task Queue

## Configuration

The Task Queue URL is configured in the backend's config file (`src/config/index.js`). It first tries to load the URL from Secret Manager, and falls back to a default URL if not found:

```javascript
// Task Queue service URL
config.TASK_QUEUE_URL = 'https://appraisers-task-queue-856401495068.us-central1.run.app';
```

## Error Handling

When forwarding requests to the Task Queue, the backend includes comprehensive error handling:

1. If the Task Queue returns an error response, it's propagated to the client
2. If the Task Queue is unavailable, a 503 Service Unavailable response is returned
3. If there's an error making the request, a 500 Internal Server Error response is returned

## Best Practices

1. **Single Responsibility**: Each component should have a single responsibility
2. **Proper Initialization**: The Task Queue is responsible for initializing all services it needs
3. **Asynchronous Processing**: Long-running tasks should be processed asynchronously
4. **Clear Error Handling**: Errors should be properly logged and reported
5. **Service Discovery**: Service URLs should be configurable

## Known Issues

If you see errors like the following:

```
Error in step STEP_MERGE_DESCRIPTIONS: Cannot read properties of undefined (reading 'mergeDescriptions')
```

It's likely because you're trying to process appraisals directly in the backend instead of forwarding to the Task Queue. Make sure all processing requests are forwarded to the Task Queue.

## Service Responsibilities and Boundaries

### Service Separation of Concerns

Each service in the application has clear responsibilities:

1. **AppraisalService**: Coordinates the overall appraisal process, maintains state in Google Sheets.
   - Handles generation of the full appraisal report by calling the backend directly
   - Responsible for PDF generation, finalization and notification

2. **WordPressService**: Handles all communication with the WordPress API.
   - Creates and updates posts
   - Manages custom fields
   - Retrieves media and post data
   - DOES NOT trigger other backend services - maintains strict separation of concerns

3. **SheetsService**: Manages all Google Sheets operations.
   - No business logic, pure data operations

4. **OpenAIService**: Handles communication with AI services.
   - Responsible for text processing and generation
   
5. **PDFService**: Manages creation of PDF reports.
   - Delegates to Google Docs for the actual generation

6. **EmailService**: Handles notification delivery.
   - Templates and sends emails

### Changes from Previous Architecture

**April 2025 Update**: Fixed architectural issue where WordPressService was improperly triggering appraisal report generation. This responsibility has been moved to the AppraisalService, which now calls the backend API directly. This change enforces proper separation of concerns - WordPress service should only communicate with WordPress, not with other backend services. 