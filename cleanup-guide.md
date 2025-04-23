# Service Cleanup Guide

This guide provides instructions for cleaning up duplicate service files in the appraisers-task-queue project.

## Current Status

We've identified several duplicated service implementations:

1. **OpenAI Service**:
   - ✅ `openai.service.js` - KEEP (improved implementation with metadata extraction)
   - ❌ `openai.js` - DEPRECATED (marked with comment)

2. **Email Service**:
   - ✅ `email.service.js` - KEEP (better error handling and parameter validation)
   - ❌ `email.js` - DEPRECATED (marked with comment)

3. **PDF Service**:
   - ✅ `pdf.service.js` - KEEP (simpler API with better initialization)
   - ❌ `pdf.js` - DEPRECATED (marked with comment)

4. **WordPress Service**:
   - ✅ `wordpress.service.js` - KEEP (improved API with better documentation)
   - ❌ `wordpress.js` - DEPRECATED (marked with comment)

## Backend Files Assessment

Backend coordination is handled by multiple files that should be kept but with clearer responsibilities:

- **app.js**: Express server setup with routes and API endpoints
- **worker.js**: PubSub message processing and service orchestration
- **processor.js**: Low-level PubSub connection management with reconnection handling

## Cleanup Instructions

1. **Update Import References**:
   - ✅ Updated `worker.js` to use the `.service.js` versions of files

2. **Remove Deprecated Files** (after verifying everything works):
   ```bash
   # Run these commands after thorough testing
   rm src/services/openai.js
   rm src/services/email.js
   rm src/services/pdf.js
   rm src/services/wordpress.js
   ```

3. **Update Documentation**:
   - ✅ Added README.md with service architecture overview
   - ✅ Added cleanup guide (this file)

## Additional Recommendations

1. **Standardize Naming**:
   - Consider renaming remaining service files to follow the `.service.js` pattern consistently

2. **Service Registration**:
   - Consider implementing a service registry pattern to centralize service initialization

3. **Error Handling**:
   - Ensure consistent error handling across all services
   - Use a standard error format for API responses

4. **Testing**:
   - Add unit tests for each service
   - Add integration tests for the complete workflow 