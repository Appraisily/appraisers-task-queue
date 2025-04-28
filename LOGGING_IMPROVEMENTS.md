# Logging Improvements

This document outlines the improvements made to reduce log verbosity in the appraisers-task-queue service.

## Overview of Changes

1. **Added Log Levels**
   - Implemented proper log levels (ERROR, WARN, INFO, DEBUG)
   - Made log level configurable via an environment variable (`LOG_LEVEL`)
   - Set default level to INFO (2)

2. **Duplicate Prevention**
   - Added a mechanism to detect and suppress duplicate log messages
   - Set a 3-second threshold for duplicate detection
   - Implemented cleanup of old entries to prevent memory leaks

3. **Message Simplification**
   - Reduced verbosity of log messages
   - Removed redundant logging of operation details
   - Simplified error messages to be more concise

4. **Services-Specific Improvements**

   **SheetsService**:
   - Added tracking of recent operations to prevent repeated logs for the same range
   - Moved verbose logging to DEBUG level
   - Simplified status updates and operation reporting

   **AppraisalService**:
   - Added tracking of status events to prevent duplicate status updates
   - Reduced status message verbosity and redundancy
   - Moved operation details to DEBUG level

   **AppraisalFinder**:
   - Simplified search and result logging
   - Reduced verbosity of cache operations

   **Worker**:
   - Removed redundant logging throughout the processing steps
   - Eliminated verbose contextual information that wasn't actionable
   - Simplified error reporting

## Configuration

The log level can be set using the `LOG_LEVEL` environment variable:
- `0`: ERROR (only errors)
- `1`: WARN (warnings and errors)
- `2`: INFO (default - informational messages, warnings, and errors)
- `3`: DEBUG (verbose debugging, plus all other levels)

## Example

Before:
```
[App] Received request to process appraisal 14 from step STEP_SET_VALUE
[SheetsService] Getting values from range: 'Pending Appraisals'!A14
[App] Appraisal 14 found in Pending sheet. Starting process...
[Worker] Processing appraisal 14 from step STEP_SET_VALUE (Sheet: Pending)
[AppraisalFinder] Getting multiple fields (J, K) for appraisal 14 from pending sheet
[SheetsService] Getting values from range: 'Pending Appraisals'!A14:Z14
...
[SheetsService] Skipping update for range: 'Pending Appraisals'!F14 - values unchanged
```

After:
```
[App] Received request to process appraisal 14 from step STEP_SET_VALUE
[Worker] Processing appraisal 14 from step STEP_SET_VALUE (Sheet: Pending)
[AppraisalService] Processing appraisal 14 (value: 15000, type: Regular) using pending sheet
[OpenAIService] Calling OpenAI to merge descriptions
[AppraisalService] Updating WordPress post 146745 with value: 15000, type: Regular
[AppraisalService] Generating appraisal report for post ID: 146745
[AppraisalService] PDF generated: [link to PDF]
[AppraisalService] Sending completion email to [customer email]
[AppraisalService] Appraisal 14 marked as complete
```

## Benefits

1. **Improved Readability**: Logs now focus on significant events rather than operational details
2. **Reduced Volume**: Duplicate and low-value messages are eliminated
3. **Better Troubleshooting**: Important events stand out more clearly
4. **Configurable Verbosity**: Level-based logging allows adjusting detail as needed

## Future Improvements

1. Consider implementing structured logging (JSON format) for better machine parsing
2. Add request IDs for better tracing across service boundaries
3. Implement log rotation and archiving to manage log files 