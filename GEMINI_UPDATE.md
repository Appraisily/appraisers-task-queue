# Gemini API Update - May 2025

## Overview

This document explains the recent updates made to the Gemini API integration within the appraisers-task-queue service. These changes were necessary to resolve the error:

```
{"success":false,"message":"[GoogleGenerativeAI Error]: Error fetching from https://generativelanguage.googleapis.com/v1/models/gemini-2.5-pro:generateContent: [404 Not Found] models/gemini-2.5-pro is not found for API version v1, or is not supported for generateContent. Call ListModels to see the list of available models and their supported methods."}
```

## Changes Made

1. **Updated Gemini Model Version**:
   - Changed from `gemini-2.5-pro` to `gemini-2.5-pro-preview-05-06` (latest available model as of May 2025)
   - This model is now the latest stable preview release according to Google's documentation, released May 6, 2025
   - We've verified this model name is correct in the official Google AI documentation

2. **Updated Gemini API Client**:
   - Updated `@google/generative-ai` package to version `0.24.1` (latest version)
   - Initially considered using `@google/genai` but found it doesn't exist in the npm registry
   - The correct official SDK remains `@google/generative-ai` at this time

3. **API Usage Remains the Same**:
   - We continue to use the established pattern with `result.response.text()`
   - No changes to the API interface were needed

## Why This Update Was Needed

Google regularly updates their Generative AI models and the previous model version (`gemini-2.5-pro`) is no longer available. This update ensures:

1. Compatibility with the latest API endpoints
2. Access to the most advanced model features and capabilities
3. Continued support and security updates

## Testing

These changes have been tested locally to ensure that:
- The service can initialize properly with the updated model version
- API requests to the Gemini service succeed
- Response data is correctly parsed and processed

## Next Steps

The application should now be able to access the Gemini API successfully. If you encounter any issues, please check:

1. That your Google Cloud project has access to the latest Gemini models
2. The Gemini API key has proper permissions
3. The service account has correct access to Secret Manager

## Reference Documentation

- [Google AI API Models Documentation](https://ai.google.dev/gemini-api/docs/models/gemini)
- [Gemini API Libraries](https://ai.google.dev/gemini-api/docs/libraries) 