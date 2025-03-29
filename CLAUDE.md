# APPRAISERS Codebase Guidelines

## Build & Run Commands
- **Task Queue**: `npm start` - Starts the Pub/Sub subscriber service
- **Lint**: Currently not configured in package.json (consider adding ESLint)
- **Tests**: Currently not configured in package.json (consider adding Jest)

## Code Style
- **JS**: ES6+, CommonJS modules with `require()` and `module.exports`
- **Naming**: camelCase (variables, functions), PascalCase (classes), UPPER_CASE (constants)
- **Formatting**: 2-space indentation, semicolons required
- **Error Handling**: Try/catch blocks for async code, detailed error messages with context
- **Logging**: Use the logger utility with named contexts, e.g. `createLogger('ServiceName')`
- **Documentation**: JSDoc for classes and methods with @param and @returns annotations

## Architecture
- **Services**: Class-based with async `initialize()` method
- **Dependency Injection**: Services receive dependencies via constructor
- **Exports**: Export classes, not instances (`module.exports = MyService`)
- **Error Management**: Log errors, clean up resources, throw for critical failures
- **Status Updates**: Use detailed status tracking with timestamps