# Appraisers Task Queue Service

This service handles the asynchronous processing of appraisal tasks using Google Cloud Pub/Sub.

## Service Architecture

### Initialization Strategy
1. **Fast Startup**: Service starts HTTP server immediately to handle health checks
2. **Background Initialization**: Services initialize asynchronously while maintaining responsiveness
3. **Sequential Loading**: Dependencies load in order to prevent race conditions:
   - Secret Manager
   - Configuration
   - WordPress Service
   - Google Sheets Service
   - OpenAI Service
   - Email Service
   - PDF Service
   - Pub/Sub Connection

### Health Check Strategy
- Endpoint: `/health`
- Returns service status and readiness
- Used by Cloud Run for container health monitoring
- Keeps service warm via scheduled pings
- Reports detailed initialization state

### Message Processing
Once fully initialized, the service:
1. Listens for Pub/Sub messages
2. Validates message structure
3. Processes appraisals through defined steps
4. Acknowledges messages to prevent duplicates
5. Handles errors gracefully with DLQ

## Process Flow

When a new message is received from Pub/Sub, the following steps are executed:

```
processAppraisal()
├─> 1. setAppraisalValue()
│   └─> Updates Google Sheets and WordPress
├─> 2. mergeDescriptions()
│   ├─> Gets IA description from Sheets
│   ├─> Uses OpenAI to merge descriptions
│   └─> Saves merged description to Sheets
├─> 3. updateTitle()
│   ├─> Gets WordPress URL from Sheets
│   └─> Updates WordPress post title
├─> 4. insertTemplate()
│   ├─> Gets appraisal type from Sheets
│   └─> Updates WordPress post content
├─> 5. buildPdf()
│   ├─> Gets WordPress data
│   ├─> Generates PDF
│   └─> Updates Sheets with PDF links
├─> 6. sendEmail()
│   ├─> Gets customer data from Sheets
│   └─> Sends email via SendGrid
└─> 7. complete()
    └─> Updates status in Sheets
```

## Service Features

- **Resilient Initialization**:
  - Handles startup failures gracefully
  - Reports initialization status via health checks
  - Auto-recovers from temporary service outages

- **Message Processing**:
  - Validates message structure
  - Processes tasks asynchronously
  - Implements retry logic with DLQ
  - Handles failed tasks gracefully

- **Integration Points**:
  - Google Sheets for data storage
  - WordPress for content management
  - OpenAI for description merging
  - SendGrid for email notifications
  - PDF service for document generation

- **Monitoring & Health**:
  - Detailed logging of operations
  - Health check endpoint for monitoring
  - Service status reporting
  - Error tracking and reporting

## Configuration

### Environment Variables

Required environment variable in `.env`:
```
GOOGLE_CLOUD_PROJECT_ID=your-project-id
```

### Google Cloud Secret Manager

The following secrets must be configured:

| Secret Name | Description |
|------------|-------------|
| `PENDING_APPRAISALS_SPREADSHEET_ID` | Google Sheets spreadsheet ID |
| `WORDPRESS_API_URL` | WordPress API endpoint URL |
| `wp_username` | WordPress username |
| `wp_app_password` | WordPress application password |
| `SENDGRID_API_KEY` | SendGrid API key |
| `SENDGRID_EMAIL` | SendGrid sender email |
| `OPENAI_API_KEY` | OpenAI API key |
| `service-account-json` | Google Service Account JSON key |

## Setup & Development

1. Install dependencies:
```bash
npm install
```

2. Configure environment variables in `.env`

3. Run locally:
```bash
npm run dev
```

## Error Handling

The service implements comprehensive error handling:

1. **Initialization Errors**:
   - Reported via health check endpoint
   - Non-blocking for HTTP server
   - Automatic retry with backoff

2. **Processing Errors**:
   - Logged with full context
   - Published to Dead Letter Queue
   - Original message acknowledged
   - Service remains operational

3. **Integration Errors**:
   - Retried with exponential backoff
   - Detailed error logging
   - Service state maintained

## Monitoring

The service exposes a health check endpoint that returns:

```json
{
  "status": "healthy|error|initializing",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "uptime": 123.456,
  "ready": true|false,
  "error": "Error message if status is error"
}
```