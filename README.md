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
   
   // Merge descriptions using OpenAI (max 200 words)
   const mergedDescription = await openaiService.mergeDescriptions(description, iaDescription);
   
   // Save merged description to Column L
   await sheetsService.updateValues(`L${id}`, [[mergedDescription]]);
   ```

3. **Update WordPress Post**
   ```javascript
   // Get existing post content
   const post = await wordpressService.getPost(postId);
   
   // Update WordPress post with merged description as title
   const { publicUrl } = await wordpressService.updateAppraisalPost(postId, {
     title: mergedDescription,
     content: post.content,
     value: value.toString()
   });

   // Save public URL to Column P
   await sheetsService.updateValues(`P${id}`, [[publicUrl]]);
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
   
   // Get customer data
   const customerData = await sheetsService.getValues(`D${id}:E${id}`);
   
   // Send completion email using SendGrid template
   await emailService.sendAppraisalCompletedEmail(customerData.email, customerData.name, {
     pdfLink,
     appraisalUrl: publicUrl
   });
   ```

6. **Mark Complete**
   ```javascript
   // Update status to "Completed" in Column F
   await sheetsService.updateValues(`F${id}`, [['Completed']]);
   ```

## Google Sheets Structure

| Column | Content              | Notes                                    |
|--------|---------------------|------------------------------------------|
| B      | Appraisal Type      | Type of item being appraised            |
| D      | Customer Email      | Used for notifications                   |
| E      | Customer Name       | Used in email templates                  |
| F      | Status              | Updated to "Completed" when done         |
| G      | WordPress Post URL  | Edit URL of the post                    |
| H      | IA Description      | Initial AI-generated description        |
| J      | Appraisal Value    | Final appraised value                   |
| K      | Original Description| Appraiser's description                 |
| L      | Merged Description  | Combined AI + Appraiser description     |
| M      | PDF Link           | Link to generated PDF report            |
| N      | Doc Link           | Link to generated Doc version           |
| P      | Public Post URL    | Public URL of the WordPress post        |

## Configuration

### Environment Variables

Required environment variable in `.env`:
```
GOOGLE_CLOUD_PROJECT_ID=your-project-id
```

### Google Cloud Secret Manager

The following secrets must be configured:

| Secret Name | Description | Example Value |
|------------|-------------|---------------|
| `PENDING_APPRAISALS_SPREADSHEET_ID` | Google Sheets spreadsheet ID | `1abc...xyz` |
| `WORDPRESS_API_URL` | WordPress API endpoint URL | `https://resources.appraisily.com/wp-json/wp/v2` |
| `wp_username` | WordPress username | `admin` |
| `wp_app_password` | WordPress application password | `xxxx xxxx xxxx` |
| `SENDGRID_API_KEY` | SendGrid API key | `SG.xxx...` |
| `SENDGRID_EMAIL` | SendGrid sender email | `noreply@appraisily.com` |
| `SEND_GRID_TEMPLATE_NOTIFY_APPRAISAL_COMPLETED` | SendGrid template ID for completion emails | `d-xxx...` |
| `OPENAI_API_KEY` | OpenAI API key | `sk-xxx...` |
| `service-account-json` | Google Service Account JSON key | `{...}` |

## WordPress Integration

### API Configuration

1. **Base URL Structure**
   - The WordPress API URL in secrets should be the base REST API URL
   - Example: `https://resources.appraisily.com/wp-json/wp/v2`
   - The service will append `/appraisals/` for custom post type endpoints

2. **Authentication**
   - Uses WordPress application passwords
   - Requires Basic Auth header with base64 encoded credentials
   - Format: `Authorization: Basic ${base64(username:app_password)}`

3. **Custom Post Type**
   - Uses custom `appraisals` post type
   - Endpoints:
     - GET/POST `/appraisals/{id}`
     - Supports standard WP fields plus custom ACF fields

4. **Post Updates**
   - Title: Uses full merged description (max 200 words)
   - Slug: Uses session ID if available (no change if not present)
   - Content: Preserves existing content, adds required shortcodes
   - ACF Fields:
     - `value`: Appraisal value
     - `shortcodes_inserted`: Boolean flag
     - `session_id`: Used for slug generation

### Important Notes

- Always use `/appraisals/` endpoint, not `/posts/`
- The merged description becomes the post title without truncation
- Only update slug when session ID is available
- Store public post URL (not edit URL) in Column P
- Verify shortcodes exist before adding them

## Email Templates

The service uses SendGrid dynamic templates for email notifications. The completion email template includes:

- Customer name
- Link to PDF report
- Link to public WordPress post
- Current year (for copyright)

The template is configured to use the Appraisily branding and styling, including:
- Logo
- Brand colors
- Responsive design
- Support for Outlook and other email clients

## WordPress Integration

Posts are updated with:
- Merged description as the title (max 200 words)
- Session ID as the slug (when available)
- Required shortcodes for PDF download and templates
- Custom fields for appraisal value

The service uses the WordPress REST API v2 endpoint and requires application password authentication.

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