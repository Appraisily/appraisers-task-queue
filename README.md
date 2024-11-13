# Appraisers Task Queue Service

This service handles the asynchronous processing of appraisal tasks using Google Cloud Pub/Sub.

## Features

- Processes appraisal tasks from Pub/Sub queue
- Updates Google Sheets and WordPress
- Sends email notifications via SendGrid
- Handles failed tasks with DLQ (Dead Letter Queue)

## Setup

1. Install dependencies:
```bash
npm install
```

2. Configure environment variables in Google Cloud Secret Manager

3. Run locally:
```bash
npm run dev
```

## Deployment

The service is deployed to Google Cloud Run using Cloud Build:

```bash
gcloud builds submit
```

## Architecture

- Uses Google Cloud Pub/Sub for message queue
- Processes tasks asynchronously
- Implements retry logic with DLQ
- Integrates with Google Sheets, WordPress, and SendGrid

## Error Handling

Failed tasks are:
1. Logged with full error details
2. Published to a Dead Letter Queue
3. Original message is acknowledged to prevent infinite retries