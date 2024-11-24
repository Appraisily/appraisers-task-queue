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
   ```javascript
   // Updates value and original description
   await sheetsService.updateValues(`J${id}:K${id}`, [[value, description]]);
   ```

2. **Merge Descriptions** (Columns H, L)
   ```javascript
   // Get IA description from Column H
   const iaDescription = await sheetsService.getValues(`H${id}`);
   
   // Merge descriptions using OpenAI
   const mergedDescription = await openaiService.mergeDescriptions(description, iaDescription);
   
   // Save merged description to Column L
   await sheetsService.updateValues(`L${id}`, [[mergedDescription]]);
   ```

3. **Update WordPress Post**
   ```javascript
   // Extract post ID from WordPress URL in Column G
   const wpUrl = "https://resources.appraisily.com/wp-admin/post.php?post=141667&action=edit";
   const postId = new URL(wpUrl).searchParams.get('post'); // Returns "141667"
   
   // Get appraisal type from Column B
   const appraisalType = await sheetsService.getValues(`B${id}`);
   
   // Update WordPress post
   await wordpressService.updatePost(postId, {
     title: `Appraisal #${id} - ${description}`,
     content: `[pdf_download]\n[AppraisalTemplates type="${appraisalType}"]`,
     acf: { value: value.toString() }
   });
   ```

4. **Complete Appraisal Report**
   ```javascript
   // Call appraisals backend to complete report
   await fetch('https://appraisals-backend-856401495068.us-central1.run.app/complete-appraisal-report', {
     method: 'POST',
     headers: { 'Content-Type': 'application/json' },
     body: JSON.stringify({ postId })
   });
   ```

5. **Generate PDF and Send Email**
   ```javascript
   // Generate PDF
   const { pdfLink, docLink } = await pdfService.generatePDF(postId);
   
   // Update PDF links in Columns M-N
   await sheetsService.updateValues(`M${id}:N${id}`, [[pdfLink, docLink]]);
   
   // Get customer email from Column D
   const customerEmail = await sheetsService.getValues(`D${id}`);
   
   // Send completion email
   await emailService.sendAppraisalCompletedEmail(customerEmail, {
     value,
     pdfLink,
     description: mergedDescription
   });
   ```

6. **Mark Complete**
   ```javascript
   // Update status to "Completed" in Column F
   await sheetsService.updateValues(`F${id}`, [['Completed']]);
   ```

## Backend API Endpoints

### Complete Appraisal Report
```
POST https://appraisals-backend-856401495068.us-central1.run.app/complete-appraisal-report

Request:
{
  "postId": "123" // WordPress post ID (required)
}

Success Response:
{
  "success": true,
  "message": "Informe de tasación completado exitosamente."
}

Error Response:
{
  "success": false,
  "message": "Error message details"
}
```

### Generate PDF
```
POST https://appraisals-backend-856401495068.us-central1.run.app/generate-pdf

Request:
{
  "postId": "123",      // WordPress post ID (required)
  "session_ID": "uuid"  // Session ID (required)
}

Success Response:
{
  "pdfLink": "https://...",
  "docLink": "https://..."
}
```

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