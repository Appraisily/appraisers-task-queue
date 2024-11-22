<command>// Update the service initialization order in initializeServices()
    // Register services in dependency order
    serviceManager.register('secretManager', secretManager);
    serviceManager.register('config', config);
    serviceManager.register('sheets', sheetsService);
    serviceManager.register('wordpress', wordpressService);
    serviceManager.register('openai', openaiService);
    serviceManager.register('email', emailService);
    serviceManager.register('appraisal', appraisalService);
    serviceManager.register('taskQueue', taskQueueService);
    serviceManager.register('pubsub', new PubSubManager());</command>