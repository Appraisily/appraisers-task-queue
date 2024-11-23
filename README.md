# Appraisers Task Queue Service

A microservice that processes appraisal tasks from Google Cloud Pub/Sub and updates Google Sheets.

## Project Structure

```
src/
  ├─ app.js              # Express server and service initialization
  ├─ worker.js           # PubSub worker and task processing
  ├─ services/           # Business logic services
  │   ├─ sheets.js       # Google Sheets operations
  │   ├─ wordpress.js    # WordPress integration
  │   ├─ openai.js       # AI text processing
  │   ├─ email.js        # Email notifications
  │   └─ pdf.js         # PDF generation
  └─ utils/
      ├─ logger.js       # Logging utility
      └─ secrets.js      # Secret Manager integration
```

## Features

- Listens for appraisal completion messages from Pub/Sub
- Updates appraisal status in Google Sheets
- Handles failed messages with Dead Letter Queue
- Health check endpoint
- Graceful shutdown
- Secure secret management using Google Cloud Secret Manager

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

## Service Architecture

1. **Initialization**:
   - Starts HTTP server for health checks
   - Retrieves secrets from Secret Manager
   - Initializes Google Sheets connection using Application Default Credentials
   - Sets up Pub/Sub subscription

2. **Message Processing**:
   - Listens for `COMPLETE_APPRAISAL` messages
   - Updates appraisal value and status in Google Sheets
   - Handles errors with Dead Letter Queue

3. **Health Check**:
   - Endpoint: `/health`
   - Returns service status and timestamp

## Setup & Development

1. Install dependencies:
```bash
npm install
```

2. Set environment variables:
```bash
export GOOGLE_CLOUD_PROJECT_ID=your-project-id
```

3. Run locally:
```bash
npm start
```

## Required Permissions

The service account running this application needs:
- `roles/pubsub.subscriber` for Pub/Sub access
- `roles/spreadsheets.editor` for Google Sheets access
- `roles/secretmanager.secretAccessor` for Secret Manager access

## Message Format

Expected Pub/Sub message format:
```json
{
  "type": "COMPLETE_APPRAISAL",
  "data": {
    "id": "42",
    "appraisalValue": 750,
    "description": "Artwork description..."
  }
}
```