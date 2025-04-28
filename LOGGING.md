# Logging System Documentation

The appraisers-task-queue service has been updated with a configurable logging system that allows you to control the verbosity of logs.

## Available Log Levels

The system supports five log levels, from least verbose to most verbose:

1. **error** - Only critical errors (highest severity)
2. **warn** - Warnings and errors
3. **info** - Standard information, warnings, and errors (default)
4. **debug** - Detailed debug information plus all of the above
5. **trace** - Very verbose logging for troubleshooting

Each level includes all log messages from the levels above it. For example, setting the level to `warn` will display both warnings and errors, but not info, debug, or trace messages.

## Configuring Log Levels

You can set the log level using the `LOG_LEVEL` environment variable:

```bash
# In development (local)
LOG_LEVEL=debug npm start

# In production (Docker/Kubernetes)
# Set the environment variable in your deployment configuration
```

By default, the log level is set to `info` in the Dockerfile, which provides a good balance between necessary information and reducing log noise.

## Log Format

Logs follow a standard format:

```
[ServiceName] Message
```

Where `ServiceName` indicates which component generated the log (e.g., App, Worker, SheetsService, etc.).

## Best Practices

1. For normal operation, use the default `info` level
2. When troubleshooting a specific issue, use `debug` level
3. For deep debugging of a complex problem, use `trace` level
4. For production systems with high throughput, consider using `warn` level to reduce log volume

## Example Log Output

The following shows how log output differs at various levels:

### With LOG_LEVEL=info (default)
```
[App] Received request to process appraisal 14 from step STEP_SET_VALUE
[Worker] Processing appraisal 14 from step STEP_SET_VALUE (Sheet: Pending)
[AppraisalService] Processing appraisal 14 (value: 15000, type: Regular) using pending sheet
```

### With LOG_LEVEL=debug
```
[App] Received request to process appraisal 14 from step STEP_SET_VALUE
[App] Appraisal 14 found in Pending sheet. Starting process...
[Worker] Processing appraisal 14 from step STEP_SET_VALUE (Sheet: Pending)
[AppraisalFinder] Getting multiple fields (J, K) for appraisal 14 from pending sheet
[SheetsService] Getting values from range: 'Pending Appraisals'!A14:Z14
[AppraisalService] Updating status for appraisal 14 to: Processing (Starting appraisal workflow)
[SheetsService] Getting values from range: 'Pending Appraisals'!F14
[SheetsService] Updating values in range: 'Pending Appraisals'!F14
[SheetsService] Update to 'Pending Appraisals'!F14 completed successfully
[AppraisalService] Processing appraisal 14 (value: 15000, type: Regular) using pending sheet
```

## Implementation Details

The logging system is implemented in `src/utils/logger.js` and uses Node.js's built-in `console` methods but adds filtering based on the configured log level.

If you're extending the system with new components, you should follow the same pattern:

```javascript
const { createLogger } = require('./utils/logger');

class MyNewComponent {
  constructor() {
    this.logger = createLogger('MyComponent');
  }
  
  myMethod() {
    this.logger.info('This is an important operational message');
    this.logger.debug('This is detailed information for debugging');
    this.logger.trace('This is extremely detailed information');
  }
}
```

This ensures consistent logging across all components of the system. 