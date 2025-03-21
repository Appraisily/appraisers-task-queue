# Appraisers Task Queue Service

A microservice that processes appraisal tasks from Google Cloud Pub/Sub, updates Google Sheets, and integrates with WordPress and the Appraisals Backend service.

## Project Overview

The Appraisers Task Queue Service is a critical component in the appraisal workflow that:
- Consumes messages from Google Cloud Pub/Sub
- Updates appraisal data in Google Sheets
- Merges descriptions using OpenAI
- Updates WordPress posts with appraisal information
- Triggers PDF generation through the Appraisals Backend service
- Tracks the process with detailed logging in Google Cloud Storage

## Architecture

```
┌───────────────────┐     ┌────────────────────┐     ┌────────────────────┐
│                   │     │                    │     │                    │
│  PubSub Message   │────▶│  Appraisers Task   │────▶│  Google Sheets     │
│                   │     │  Queue Service     │     │                    │
└───────────────────┘     └─────────┬──────────┘     └────────────────────┘
                                    │
                                    ▼
┌───────────────────┐     ┌────────────────────┐     ┌────────────────────┐
│                   │     │                    │     │                    │
│  OpenAI Service   │◀───▶│  WordPress API     │────▶│  Appraisals Backend│
│                   │     │                    │     │                    │
└───────────────────┘     └────────────────────┘     └────────────────────┘
                                    │
                                    ▼
                          ┌────────────────────┐
                          │                    │
                          │  GCS Logging       │
                          │                    │
                          └────────────────────┘
```

## Project Structure

```
src/
  ├─ app.js                   # Express server and service initialization
  ├─ worker.js                # PubSub worker and task processing
  ├─ services/                # Business logic services
  │   ├─ appraisal.service.js # Core appraisal processing logic
  │   ├─ sheets.service.js    # Google Sheets operations
  │   ├─ wordpress.service.js # WordPress integration for content
  │   ├─ openai.js            # AI text processing with OpenAI
  │   ├─ email.js             # Email notifications via SendGrid
  │   └─ pdf.js               # PDF generation service
  └─ utils/
      ├─ logger.js            # Logging utility with console output
      ├─ gcsLogger.js         # Google Cloud Storage logging with batching
      └─ secrets.js           # Secret Manager with fallbacks and caching
```

## Features

- **Reliable Message Processing**: Listens for appraisal completion messages from Pub/Sub with robust error handling
- **Google Sheets Integration**: Updates appraisal status and data in real-time
- **AI-Powered Descriptions**: Uses OpenAI to merge appraiser and IA descriptions for consistent output
- **WordPress Content Management**: Updates WordPress posts with appraisal details and ACF fields
- **PDF Generation**: Triggers the Appraisals Backend service to generate PDF reports
- **Batched GCS Logging**: Logs all operations with session-specific organization in Google Cloud Storage
- **Resilient Error Handling**: Handles failures gracefully with detailed logging
- **Health Monitoring**: Provides health check endpoints for Cloud Run monitoring
- **Graceful Shutdown**: Properly handles service shutdowns to prevent data loss
- **Secret Management**: Secure secret handling with fallbacks and environment variable support

## Detailed Process Flow

### Appraisal Processing Workflow

1. **Receive Pub/Sub Message**
   - Message validation and extraction of appraisal details
   - Identification of the row in Google Sheets using the ID

2. **Initial Status Update**
   - Update status column to "Processing"
   - Set the appraisal value and initial description

3. **Description Merging**
   - Retrieve existing IA description from Google Sheets
   - Use OpenAI to merge appraiser and IA descriptions
   - Save the merged description back to Google Sheets

4. **Appraisal Type Determination**
   - Get appraisal type from message or Google Sheets (column B)
   - Validate and normalize type (Regular, IRS, Insurance)

5. **WordPress Post Update**
   - Get the WordPress post ID from Google Sheets
   - Update the post with merged description, appraisal value, and type
   - Update custom fields (ACF) and ensure shortcodes are inserted
   - Save the public URL back to Google Sheets

6. **Report Generation Process**
   - **Step 1: Complete Appraisal Report**
     - Call Appraisals Backend `/complete-appraisal-report` endpoint
     - Process appraisal data for reporting
   
   - **Step 2: Generate PDF Document**
     - Call Appraisals Backend `/generate-pdf` endpoint
     - Create downloadable PDF document
   
   - Both steps proceed independently and failures are handled gracefully

7. **Finalization**
   - Update status to "Complete"
   - Ensure all logs are flushed to GCS for the session

### Logging System

The service implements a sophisticated logging system with several components:

1. **Console Logging**: All operations are logged to stdout/stderr for Cloud Run monitoring
2. **Google Cloud Storage Logging**: Logs are also saved to GCS with session-specific organization
3. **Batched Logging**: Logs are collected in memory and flushed to GCS in batches:
   - When a batch reaches 100 entries
   - On error events
   - At process completion
   - On service shutdown
   - After a 60-second timeout

Logs are stored in the GCS bucket `appraisily-image-backups` with the following structure:
```
/sessionId/logs/task_queue_batch_timestamp.json
```

## Error Handling

The service implements comprehensive error handling:

1. **Non-Critical Failures**: Certain failures (e.g., PDF generation) are treated as non-critical and don't halt the overall process
2. **Critical Failures**: Failures in core functions (e.g., WordPress update) are properly logged and reported
3. **Dead Letter Queue**: Failed messages are sent to a Dead Letter Queue (DLQ) for later analysis
4. **Fallback Mechanisms**: Critical configurations have fallbacks:
   - Secret Manager with environment variable fallbacks
   - Default values where appropriate
   - Retry mechanisms for transient failures

## Environment Configuration

The service can be configured using the following environment variables:

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | The port the service listens on | 8080 |
| `GOOGLE_CLOUD_PROJECT_ID` | GCP project ID | civil-forge-403609 |
| `PENDING_APPRAISALS_SPREADSHEET_ID` | Google Sheets spreadsheet ID | (from Secret Manager with fallback) |
| `APPRAISALS_BACKEND_URL` | URL for the Appraisals Backend service | https://appraisals-backend-856401495068.us-central1.run.app |

## Deployment

The service is deployed on Google Cloud Run and configured to:
- Auto-scale based on traffic
- Authenticate with Google services using service account credentials
- Integrate with Cloud Monitoring for observability
- Connect to Pub/Sub for message processing
- Access Secret Manager for secure configuration
- Write logs to Google Cloud Storage

## API Endpoints

- **GET /** - Basic health check
- **GET /health** - Detailed health check with service status
- **POST /test-log** - Test endpoint for logging (legacy)
- **POST /test-gcs-log** - Test endpoint for GCS logging

## Dependencies

- **@google-cloud/pubsub**: Pub/Sub client for message processing
- **@google-cloud/secret-manager**: Secret Manager for secure configuration
- **@google-cloud/storage**: GCS client for log storage
- **@sendgrid/mail**: SendGrid client for email notifications
- **express**: Web server framework
- **node-fetch**: HTTP client for API requests
- **openai**: OpenAI client for AI text processing