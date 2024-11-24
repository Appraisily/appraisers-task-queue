## Service Architecture and Initialization

### Service Classes

All services in the `src/services` directory follow these patterns:

1. **Class-based Structure**
   - Services are defined as classes
   - Export the class itself, not instances
   - Instances are created in the worker

2. **Initialization Pattern**
   ```javascript
   // Wrong - Don't export instance
   class MyService {}
   module.exports = new MyService();

   // Correct - Export class
   class MyService {}
   module.exports = MyService;
   ```

3. **Service Dependencies**
   - Services with dependencies receive them through constructor
   - Dependencies are initialized in the worker
   - Follows dependency injection pattern

### Worker Initialization

The worker (`src/worker.js`) handles service initialization:

1. Creates service instances
2. Initializes them in correct order
3. Injects dependencies where needed

Example:
```javascript
// In worker.js
const WordPressService = require('./services/wordpress');
const wordpressService = new WordPressService();
await wordpressService.initialize();
```

### Service Requirements

Each service class must:

1. Have a constructor that accepts required dependencies
2. Have an async `initialize()` method
3. Export the class, not an instance
4. Use dependency injection for external services

### Error Handling

Services should:

1. Log initialization errors
2. Throw errors for critical failures
3. Include detailed error messages
4. Clean up resources on failure