const AppraisalService = require('./appraisal.service');
const SheetsService = require('./sheets.service');
const WordPressService = require('./wordpress.service');
const OpenAIService = require('./openai.service');
const EmailService = require('./email.service');
const PDFService = require('./pdf.service');

// Create service instances
const services = {
  sheets: new SheetsService(),
  wordpress: new WordPressService(),
  openai: new OpenAIService(),
  email: new EmailService(),
  pdf: new PDFService(),
};

// Create and initialize appraisal service with dependencies
const appraisalService = new AppraisalService(services);

module.exports = {
  appraisalService,
  services
};