# Appraisers Task Queue Service

A microservice that processes appraisal tasks from Google Cloud Pub/Sub, updates Google Sheets, integrates with WordPress, and manages the full lifecycle of appraisal reports.

## Project Structure

```
src/
  ├─ app.js                # Express server and service initialization
  ├─ processor.js          # Core processing logic
  ├─ worker.js             # PubSub worker and task processing
  ├─ services/             # Business logic services
  │   ├─ appraisal.service.js  # Core appraisal processing logic
  │   ├─ email.service.js      # Email notifications
  │   ├─ openai.service.js     # AI text processing
  │   ├─ pdf.service.js        # PDF generation
  │   ├─ sheets.service.js     # Google Sheets operations
  │   └─ wordpress.service.js  # WordPress integration
  └─ utils/
      ├─ logger.js         # Logging utility
      └─ secrets.js        # Secret Manager integration
```

## Key Features

- Subscribes to Pub/Sub topics for appraisal processing tasks
- Orchestrates the end-to-end appraisal completion workflow
- Updates Google Sheets with detailed status tracking
- Integrates with OpenAI for description enhancement
- Manages WordPress content generation and updates
- Handles PDF generation via appraisals-backend service
- Sends email notifications to customers with completed reports
- Provides detailed status tracking with timestamps for each processing step
- Uses Google Cloud Secret Manager for secure credential management
- Implements comprehensive error handling with Dead Letter Queue
- Includes health check endpoints and graceful shutdown mechanisms

## Quick Start

### Prerequisites

- Node.js 16+
- Google Cloud project with Pub/Sub, Secret Manager access
- Google service account with Sheets API access

### Installation

1. Clone the repository
2. Install dependencies:
   ```
   npm install
   ```
3. Set up environment variables:
   ```
   GOOGLE_CLOUD_PROJECT_ID=your-project-id
   ```

### Running the Service

```bash
# Start production service
npm start

# Run tests
npm test

# Run linting
npm run lint
```

## Appraisal Processing Workflow

The service follows this sequential processing pipeline:

1. **Receive Message**: Accept Pub/Sub message with appraisal data
   - Validates message format and required fields
   - Extracts appraisal ID, value, description, and type

2. **Initial Processing**: Set value and description in Google Sheets
   - Updates appraisal value and status in the spreadsheet
   - Writes initial status log entry with timestamp

3. **Enhance Description**: Merge customer and AI descriptions using OpenAI
   - Combines appraiser's description with AI-generated content
   - Creates cohesive narrative with professional terminology
   - Updates merged description in Google Sheets

4. **Determine Type**: Set appraisal type (Regular, IRS, or Insurance)
   - Determines appropriate document template
   - Sets additional fields based on appraisal type

5. **Update WordPress**: Update post with merged description and metadata
   - Updates WordPress post content
   - Sets ACF fields with appraisal metadata
   - Triggers content processing on WordPress

6. **Generate Report**: Call backend API to build the complete appraisal report
   - Requests HTML content generation
   - Processes statistics and visualizations
   - Prepares professional report layout

7. **Create PDF**: Generate PDF version of the report
   - Calls appraisals-backend service to create PDF
   - Stores the generated file on Google Drive
   - Updates Sheets with document links

8. **Notify Customer**: Send email with links to the completed appraisal
   - Uses SendGrid templates for email formatting
   - Includes PDF download links
   - Records email delivery status

9. **Finalize**: Mark as complete and move to the completed sheet
   - Updates final status in Google Sheets
   - Copies record to completed spreadsheet
   - Removes from pending list

Each step includes detailed status tracking in both Google Sheets and WordPress.

## Message Format

Expected Pub/Sub message format:
```json
{
  "type": "COMPLETE_APPRAISAL",
  "data": {
    "id": "123",
    "appraisalValue": 1500,
    "description": "A beautiful oil painting",
    "appraisalType": "Regular"  // Optional, one of: Regular, IRS, Insurance
  }
}
```

## Google Sheets Structure

| Column | Content             | Notes                                  |
|--------|---------------------|----------------------------------------|
| B      | Appraisal Type      | Template selection: Regular/IRS/Insurance |
| D      | Customer Email      | For notifications                      |
| E      | Customer Name       | Used in email templates                |
| F      | Status              | Current processing status              |
| G      | WordPress Post URL  | Edit URL for the post                  |
| H      | AI Description      | Initial AI-generated description       |
| J      | Appraisal Value     | Final appraised value                  |
| K      | Original Description| Appraiser's description                |
| L      | Merged Description  | Combined AI + Appraiser description    |
| M      | PDF Link            | Link to generated PDF report           |
| N      | Doc Link            | Link to generated Doc version          |
| P      | Public Post URL     | Public URL of the WordPress post       |
| Q      | Email Status        | Delivery timestamp and message ID      |
| R      | Detailed Status Log | Timestamped progress updates           |

## Status Tracking

The service provides detailed status tracking with timestamped updates:

- **Processing**: Initial data setup and validation
- **Analyzing**: Description merging and type determination
- **Updating**: WordPress content updates
- **Generating**: Report building and template processing
- **Finalizing**: PDF creation and email notification
- **Completed**: Successfully processed
- **Failed**: Error occurred (with detailed error message)

## WordPress Integration

- Updates custom post type with merged descriptions
- Sets appraisal value and type as custom fields
- Manages template shortcodes for report generation
- Triggers the backend API for PDF generation
- Updates status tracking fields for front-end display

## Configuration

### Google Cloud Secret Manager

Required secrets:

| Secret Name | Description | Example Value |
|------------|-------------|---------------|
| `PENDING_APPRAISALS_SPREADSHEET_ID` | Google Sheets ID | `1abc...xyz` |
| `WORDPRESS_API_URL` | WordPress API URL | `https://resources.appraisily.com/wp-json/wp/v2` |
| `wp_username` | WordPress username | `admin` |
| `wp_app_password` | WordPress app password | `xxxx xxxx xxxx` |
| `SENDGRID_API_KEY` | SendGrid API key | `SG.xxx...` |
| `SENDGRID_EMAIL` | SendGrid sender email | `noreply@appraisily.com` |
| `SEND_GRID_TEMPLATE_NOTIFY_APPRAISAL_COMPLETED` | SendGrid template ID | `d-xxx...` |
| `OPENAI_API_KEY` | OpenAI API key | `sk-xxx...` |
| `service-account-json` | Google Service Account | `{...}` |

## Error Handling

The service implements comprehensive error handling:

- Detailed error logging with context
- Status updates in Sheets for failed steps
- Publishing to Dead Letter Queue for failed messages
- Graceful degradation for non-critical failures
- Retry strategies for transient errors

## Health Checks

The service exposes a health check endpoint at `/health` that returns:
```json
{
  "status": "ok",
  "timestamp": "2024-11-25T11:20:01.564Z",
  "uptime": "1d 2h 15m",
  "memory": {
    "rss": "75MB",
    "heapTotal": "50MB",
    "heapUsed": "45MB"
  }
}
```

## Development

See [DEVELOPMENT.md](DEVELOPMENT.md) for architecture guidelines and service patterns.
See [CLAUDE.md](../CLAUDE.md) for code style guidelines and development commands.

## Deployment

The service is deployed to Google Cloud Run:

```bash
# Build Docker image
docker build -t gcr.io/[PROJECT_ID]/appraisers-task-queue .

# Push to Google Container Registry
docker push gcr.io/[PROJECT_ID]/appraisers-task-queue

# Deploy to Cloud Run
gcloud run deploy appraisers-task-queue \
  --image gcr.io/[PROJECT_ID]/appraisers-task-queue \
  --platform managed \
  --region [REGION] \
  --memory 512Mi \
  --concurrency 50 \
  --min-instances 1
```

## Monitoring and Logging

- Uses structured JSON logging
- Integrates with Google Cloud Logging
- Exports metrics to Google Cloud Monitoring
- Tracks processing times for performance analysis

## License

MIT License - See LICENSE file for details