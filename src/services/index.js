const appraisalService = require('./appraisal.service');
const emailService = require('./email.service');
const openaiService = require('./openai.service');
const pdfService = require('./pdf.service');
const sheetsService = require('./sheets.service');
const wordpressService = require('./wordpress.service');

module.exports = {
  appraisalService,
  emailService,
  openaiService,
  pdfService,
  sheetsService,
  wordpressService
};