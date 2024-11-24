const sendGridMail = require('@sendgrid/mail');
const { createLogger } = require('../utils/logger');
const secretManager = require('../utils/secrets');

class EmailService {
  constructor() {
    this.logger = createLogger('Email');
    this.senderEmail = null;
  }

  async initialize() {
    const apiKey = await secretManager.getSecret('SENDGRID_API_KEY');
    this.senderEmail = await secretManager.getSecret('SENDGRID_EMAIL');
    sendGridMail.setApiKey(apiKey);
  }

  async sendAppraisalCompletedEmail(customerEmail, customerName, appraisalData) {
    const msg = {
      to: customerEmail,
      from: this.senderEmail,
      subject: 'Your Appraisal is Complete',
      text: `Dear ${customerName},\n\nYour appraisal is now complete. The appraised value is ${appraisalData.value}.\n\nYou can view your full appraisal here: ${appraisalData.pdfLink}`,
      html: `<p>Dear ${customerName},</p>
            <p>Your appraisal is now complete. The appraised value is ${appraisalData.value}.</p>
            <p>You can view your full appraisal <a href="${appraisalData.pdfLink}">here</a>.</p>`
    };

    await sendGridMail.send(msg);
  }
}

module.exports = EmailService;