# Appraisers Task Queue Service

A microservice that processes appraisal tasks from Google Cloud Pub/Sub and updates Google Sheets.

## Project Structure

```
src/
  ├─ app.js              # Express server and service initialization
  ├─ worker.js           # PubSub worker and task processing
  ├─ services/           # Business logic services
  │   ├─ appraisal.js   # Core appraisal processing logic
  │   ├─ sheets.js      # Google Sheets operations
  │   ├─ wordpress.js   # WordPress integration
  │   ├─ openai.js      # AI text processing
  │   ├─ email.js       # Email notifications
  │   └─ pdf.js         # PDF generation
  └─ utils/
      ├─ logger.js      # Logging utility
      └─ secrets.js     # Secret Manager integration
```

## Features

- Listens for appraisal completion messages from Pub/Sub
- Updates appraisal status in Google Sheets
- Handles failed messages with Dead Letter Queue
- Health check endpoint
- Graceful shutdown
- Secure secret management using Google Cloud Secret Manager

## Appraisal Process Flow

When a new message is received from Pub/Sub, the following steps are executed in order:

1. **Set Appraisal Value** (Columns J-K)
   - Updates appraisal value in Google Sheets
   - Stores original appraiser description

2. **Merge Descriptions** (Columns H, L)
   - Retrieves IA description from Sheets (Column H)
   - Uses OpenAI to merge appraiser and IA descriptions
   - Saves merged description to Sheets (Column L)

3. **Update WordPress Post**
   - Extracts post ID from WordPress admin URL (Column G)
   - Updates post title with appraisal ID and description preview
   - Inserts required shortcodes:
     - `[pdf_download]`
     - `[AppraisalTemplates type="TYPE"]` (TYPE from Column B)

4. **Generate PDF and Send Email**
   - Generates PDF using WordPress post data
   - Updates PDF and Doc links in Sheets (Columns M-N)
   - Retrieves customer email (Column D)
   - Sends completion email with PDF link

5. **Mark Complete**
   - Updates status to "Completed" (Column F)

## Google Sheets Structure

| Column | Content              |
|--------|---------------------|
| B      | Appraisal Type      |
| D      | Customer Email      |
| E      | Customer Name       |
| F      | Status              |
| G      | WordPress Post URL  |
| H      | IA Description      |
| J      | Appraisal Value    |
| K      | Original Description|
| L      | Merged Description  |
| M      | PDF Link           |
| N      | Doc Link           |

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

## Error Handling

Failed messages are:
1. Logged with detailed error information
2. Published to a Dead Letter Queue topic (`appraisals-failed`)
3. Original message is acknowledged to prevent infinite retries

The DLQ message includes:
- Original message ID
- Original message data
- Error message
- Timestamp of failure