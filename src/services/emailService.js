const sendGridMail = require('@sendgrid/mail');
const { config } = require('../config');

class EmailService {
  constructor() {
    sendGridMail.setApiKey(config.SENDGRID_API_KEY);
  }

  async sendAppraisalCompletedEmail(customerEmail, customerName, appraisalData) {
    try {
      const currentYear = new Date().getFullYear();

      const emailContent = {
        to: customerEmail,
        from: config.SENDGRID_EMAIL,
        templateId: config.SEND_GRID_TEMPLATE_NOTIFY_APPRAISAL_COMPLETED,
        dynamic_template_data: {
          customer_name: customerName,
          appraisal_value: appraisalData.value,
          description: appraisalData.description,
          pdf_link: appraisalData.pdfLink,
          dashboard_link: `https://www.appraisily.com/dashboard/?email=${encodeURIComponent(customerEmail)}`,
          current_year: currentYear,
        },
      };

      await sendGridMail.send(emailContent);
      console.log(`Appraisal completed email sent to ${customerEmail}`);
    } catch (error) {
      console.error('Error sending appraisal completed email:', error);
      throw error;
    }
  }
}

module.exports = new EmailService();