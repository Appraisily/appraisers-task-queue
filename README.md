# Appraisers Task Queue Service

This service handles the asynchronous processing of appraisal tasks using Google Cloud Pub/Sub.

## Features

- Processes appraisal tasks from Pub/Sub queue
- Updates Google Sheets and WordPress
- Sends email notifications via SendGrid
- Handles failed tasks with DLQ (Dead Letter Queue)

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

The following secrets must be configured in Secret Manager with these exact names:

| Secret Name | Description |
|------------|-------------|
| `PENDING_APPRAISALS_SPREADSHEET_ID` | Google Sheets spreadsheet ID |
| `WORDPRESS_API_URL` | WordPress API endpoint URL |
| `wp_username` | WordPress username |
| `wp_app_password` | WordPress application password |
| `SENDGRID_API_KEY` | SendGrid API key |
| `SENDGRID_EMAIL` | SendGrid sender email |
| `SENDGRID_SECRET_NAME` | SendGrid secret name |
| `SEND_GRID_TEMPLATE_NOTIFY_APPRAISAL_COMPLETED` | SendGrid email template ID |
| `OPENAI_API_KEY` | OpenAI API key |

## Setup

1. Install dependencies:
```bash
npm install
```

2. Configure the environment variable in `.env`

3. Ensure all secrets are configured in Google Cloud Secret Manager with the exact names listed above

4. Run locally:
```bash
npm run dev
```

## Architecture

- Uses Google Cloud Pub/Sub for message queue
- Processes tasks asynchronously
- Implements retry logic with DLQ
- Integrates with:
  - Google Sheets for data storage
  - WordPress for content management
  - OpenAI for description merging
  - SendGrid for email notifications

## Error Handling

Failed tasks are:
1. Logged with full error details
2. Published to a Dead Letter Queue
3. Original message is acknowledged to prevent infinite retries