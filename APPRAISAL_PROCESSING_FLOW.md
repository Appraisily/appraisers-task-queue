# Appraisal Processing Flow

This document outlines the step-by-step process of how the appraisal task queue works, from receiving an API request to completing an appraisal.

## Request Handling & Main Flow

1. **API Endpoint** (`app.js`)
   - Receives a POST request to `/api/process-step` with parameters: `id`, `startStep`, and optional `options`
   - Determines which sheet (Pending or Completed) contains the appraisal using `appraisalFinder.appraisalExists(id)`
   - Calls `worker.processFromStep(id, startStep, usingCompletedSheet, options)`

2. **Worker Processing** (`worker.js`)
   - `processFromStep` method uses a switch statement to handle different steps
   - Each case (STEP_SET_VALUE, STEP_MERGE_DESCRIPTIONS, etc.) performs specific operations
   - Most steps eventually call `appraisalService.processAppraisal()` for the main workflow
   - Passes the `usingCompletedSheet` flag to avoid redundant sheet determination

3. **Main Appraisal Processing** (`appraisal.service.js`)
   - The `processAppraisal` method orchestrates the entire end-to-end appraisal flow
   - Accepts the `usingCompletedSheet` flag to avoid redundant sheet lookups
   - Returns either success or throws an error which propagates back to the API response

## Detailed Step-by-Step Flow

### Step 1: Initial Status Update
- Update status to "Processing" in column F
- The input value from sheets is used as-is (no value formatting in this step)
- We skip writing back to the source cell J since it's the input data

### Step 2: AI Analysis & Merging
- Update status to "Analyzing (Checking for existing AI description)"
- Check if there is already an AI-generated description in column H
- If AI description exists in column H, use it; otherwise:
  - Retrieve the main image from WordPress post
  - Generate new AI description using GPT-4o's image analysis capabilities
  - Save the AI-generated description to column H
- Get appraiser's description from column K (this takes precedence)
- Merge appraiser's description with AI description using OpenAI
  - The appraiser's description is considered authoritative
  - In case of contradictions, the appraiser's information is prioritized
- Save the merged description to column L
- Generate a brief title and detailed title
- Save titles to columns S and T
- Update WordPress post with the new titles and metadata

### Step 3: WordPress Update
- Extract WordPress post ID from the URL in column G
- Safely convert the value to a string, handling potential Promise objects
- Update the WordPress post with:
  - Brief title as the post title
  - Formatted value in the ACF "value" field
  - Appraisal type in the ACF "appraisalType" field
  - Detailed title in the ACF "detailedTitle" field
- Save the public URL to column P

### Step 4: Complete Appraisal Report Generation
- Update status to "Generating (Building full appraisal report)"
- Call `wordpressService.completeAppraisalReport(postId)` to generate the complete appraisal report
- This step is comprehensive and includes:
  - Processing the main image with Google Vision AI
  - Processing all metadata fields for the appraisal report
  - Generating specialized field content (authorship, valuation method, condition report, etc.)
  - Processing justification metadata to explain the appraised value
  - Generating HTML visualizations based on statistical data
  - Updating WordPress with all metadata and visualizations
- Update status to "Generating (Appraisal report created successfully)"

### Step 5: PDF Generation
- Update status to "Finalizing (Creating PDF document)"
- Call `pdfService.generatePDF(postId)` to create the PDF document
- Validate the returned PDF links
- Save PDF links to columns M and N
- Update status to "Finalizing (PDF created: [link])"

### Step 6: Finalization & Email
- Get customer data (email, name) from columns D and E
- Send email notification to the customer with PDF links
- Save email delivery status to column Q
- If in the Pending sheet, mark as "Completed" and move to Completed sheet
- If already in Completed sheet, just update status to "Completed"

## Error Handling
- If any step fails, update status to "Failed" with an error message
- Log detailed error information
- Return error to the API caller with a 500 status code

## Special Steps

Each `startStep` in the API has specific behavior:

### STEP_SET_VALUE
- Entry point for starting a full appraisal process
- Gets the appraisal value and description from the sheet
- Proceeds through the entire workflow

### STEP_MERGE_DESCRIPTIONS 
- Specifically focuses on AI analysis and description merging
- Checks for existing AI-generated description; only generates a new one if needed
- Prioritizes the appraiser's description when merging with AI description
- Updates WordPress with the merged content and generated titles
- Does not generate PDF or perform other downstream steps

### STEP_UPDATE_WORDPRESS
- Updates only the WordPress post with current data
- Does not trigger visualizations or PDF generation

### STEP_GENERATE_VISUALIZATION
- Specifically triggers the complete appraisal report generation
- Processes all metadata, generates justification, and creates visualizations
- Creates a comprehensive professional appraisal report in WordPress

### STEP_GENERATE_PDF
- Focuses solely on generating the PDF
- Sends the email notification if successful

### STEP_BUILD_REPORT
- Similar to STEP_SET_VALUE but assumes all initial data is already set
- Runs the entire workflow from existing data

## Data Structure (Sheet Columns)

| Column | Data                              | Notes                                |
|--------|-----------------------------------|--------------------------------------|
| A      | Appraisal ID                      | Used as row ID                       |
| B      | Appraisal Type                    | (Regular, IRS, Insurance)            |
| D-E    | Customer Email & Name             | Used for email notification          |
| F      | Status                            | Constantly updated during processing |
| G      | WordPress URL                     | Contains post ID in query params     |
| H      | AI-Generated Description          | From OpenAI image analysis           |
| J      | Appraisal Value                   | Main input value                     |
| K      | Customer Description              | Customer-provided description        |
| L      | Merged Description                | Combined AI + customer descriptions  |
| M-N    | PDF & Doc Links                   | Generated PDF document links         |
| P      | Public URL                        | Public-facing URL of the appraisal   |
| Q      | Email Status                      | Delivery status of notification      |
| S-T    | Brief Title & Detailed Title      | Generated titles for the appraisal   |

## Recent Improvements

1. **Optimized Sheet Determination**: Now passing `usingCompletedSheet` from the API endpoint all the way through to avoid redundant checks
2. **Eliminated Value Overwriting**: No longer updating cell J (value) during processing since it's the source data
3. **Enhanced Value Handling**: Improved handling of value formatting in `updateWordPress` to properly handle Promise objects and invalid values
4. **Removed Redundant Update Calls**: Eliminated description update in cell K (was unnecessary)

## Current Issues Still to Address

1. **PDF Generation Failing**: Error 500 with message "Unexpected token u in JSON at position 0"
2. **Status Updating Issues**: Multiple status updates to the same value in quick succession
3. **Error Cascading**: Multiple error status updates when a single failure occurs
4. **Inefficient Data Retrieval**: Still making multiple API calls for individual columns rather than batching

## Next Steps for Improvement

1. Debug and fix PDF generation issues
2. Reduce redundant status updates
3. Improve error handling to prevent cascading errors
4. Implement more comprehensive batching of sheet operations 