const { createLogger } = require('../utils/logger');
const fetch = require('node-fetch');
const cheerio = require('cheerio');
const url = require('url');

/**
 * Service for extracting content from existing appraisal URLs
 */
class ContentExtractionService {
  constructor(wordpressService) {
    this.logger = createLogger('ContentExtractionService');
    this.wordpressService = wordpressService;
  }

  /**
   * Extract content from an appraisal URL
   * @param {string} appraisalUrl - The URL of the appraisal to extract content from
   * @returns {Promise<object>} - The extracted content
   */
  async extractContent(appraisalUrl) {
    try {
      this.logger.info(`Extracting content from URL: ${appraisalUrl}`);
      
      // Validate URL
      if (!this.isValidAppraisalUrl(appraisalUrl)) {
        throw new Error('Invalid appraisal URL: Must be from appraisily.com domain');
      }
      
      // Fetch the HTML content
      const response = await fetch(appraisalUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
      });
      
      if (!response.ok) {
        throw new Error(`Failed to fetch URL: ${response.status} ${response.statusText}`);
      }
      
      const html = await response.text();
      
      // Parse the HTML
      const $ = cheerio.load(html);
      
      // Extract data
      const extractedData = {
        value: this.extractAppraisalValue($),
        images: {
          main: this.extractMainImage($),
          age: this.extractAgeImage($),
          signature: this.extractSignatureImage($)
        },
        descriptions: {
          appraiser: this.extractAppraiserDescription($),
          customer: this.extractCustomerDescription($),
          ai: this.extractAIDescription($)
        },
        metadata: this.extractMetadata($)
      };
      
      this.logger.info('Content extraction completed successfully');
      return extractedData;
    } catch (error) {
      this.logger.error('Error extracting content:', error);
      throw error;
    }
  }
  
  /**
   * Validate that the URL is from the appraisily.com domain
   * @param {string} urlString - The URL to validate
   * @returns {boolean} - Whether the URL is valid
   */
  isValidAppraisalUrl(urlString) {
    try {
      const parsedUrl = new URL(urlString);
      return parsedUrl.hostname.includes('appraisily.com');
    } catch (error) {
      return false;
    }
  }
  
  /**
   * Extract the appraisal value from the HTML
   * @param {object} $ - Cheerio object
   * @returns {object} - The appraisal value and currency
   */
  extractAppraisalValue($) {
    try {
      // Find the appraisal value - typically in a header or specific section
      const valueText = $('.appraisal-value').text() || 
                        $('h1:contains("Appraisal Value")').next().text() ||
                        $('strong:contains("Appraised For:")').parent().text();
      
      if (!valueText) {
        return { amount: null, currency: 'USD', formatted: null };
      }
      
      // Extract numeric value and currency
      const valueMatch = valueText.match(/[$€£]?([0-9,]+(?:\.[0-9]+)?)/);
      const currencyMatch = valueText.match(/[$€£]/);
      
      const amount = valueMatch ? parseFloat(valueMatch[1].replace(/,/g, '')) : null;
      const currency = currencyMatch ? 
        (currencyMatch[0] === '$' ? 'USD' : 
         currencyMatch[0] === '€' ? 'EUR' : 
         currencyMatch[0] === '£' ? 'GBP' : 'USD') : 'USD';
       
      // Format the value for display
      const formatter = new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: currency
      });
      
      const formatted = amount ? formatter.format(amount) : null;
      
      return { amount, currency, formatted };
    } catch (error) {
      this.logger.error('Error extracting appraisal value:', error);
      return { amount: null, currency: 'USD', formatted: null };
    }
  }
  
  /**
   * Extract the main image from the HTML
   * @param {object} $ - Cheerio object
   * @returns {object} - The main image URL
   */
  extractMainImage($) {
    try {
      // Look for the main image using various selectors
      const mainImageUrl = $('.main-image img').attr('src') || 
                          $('.wp-block-image img').first().attr('src') ||
                          $('img.wp-post-image').attr('src') ||
                          $('figure.wp-block-image img').first().attr('src');
                          
      return { url: mainImageUrl || null, localPath: null };
    } catch (error) {
      this.logger.error('Error extracting main image:', error);
      return { url: null, localPath: null };
    }
  }
  
  /**
   * Extract the age verification image from the HTML
   * @param {object} $ - Cheerio object
   * @returns {object} - The age verification image URL
   */
  extractAgeImage($) {
    try {
      // Age verification image is typically labeled
      const ageImageUrl = $('.age-image img').attr('src') || 
                          $('img[alt*="age"]').attr('src') ||
                          $('figure:contains("Age")').find('img').attr('src');
                          
      return { url: ageImageUrl || null, localPath: null };
    } catch (error) {
      this.logger.error('Error extracting age image:', error);
      return { url: null, localPath: null };
    }
  }
  
  /**
   * Extract the signature image from the HTML
   * @param {object} $ - Cheerio object
   * @returns {object} - The signature image URL
   */
  extractSignatureImage($) {
    try {
      // Signature image is typically labeled
      const signatureImageUrl = $('.signature-image img').attr('src') || 
                               $('img[alt*="signature"]').attr('src') ||
                               $('figure:contains("Signature")').find('img').attr('src');
                               
      return { url: signatureImageUrl || null, localPath: null };
    } catch (error) {
      this.logger.error('Error extracting signature image:', error);
      return { url: null, localPath: null };
    }
  }
  
  /**
   * Extract the appraiser's description from the HTML
   * @param {object} $ - Cheerio object
   * @returns {string} - The appraiser's description
   */
  extractAppraiserDescription($) {
    try {
      // Appraiser's description is typically in a specific section
      const description = $('.appraiser-description').text() || 
                          $('h2:contains("Professional Description")').next().text() ||
                          $('strong:contains("Professional Description")').parent().next().text() ||
                          $('.wp-block-group:contains("Professional Description")').find('p').text();
      
      return description ? description.trim() : null;
    } catch (error) {
      this.logger.error('Error extracting appraiser description:', error);
      return null;
    }
  }
  
  /**
   * Extract the customer's description from the HTML
   * @param {object} $ - Cheerio object
   * @returns {string} - The customer's description
   */
  extractCustomerDescription($) {
    try {
      // Customer's description is typically in a specific section
      const description = $('.customer-description').text() || 
                          $('h2:contains("Customer Description")').next().text() ||
                          $('strong:contains("Customer Description")').parent().next().text() ||
                          $('.wp-block-group:contains("Customer Description")').find('p').text();
      
      return description ? description.trim() : null;
    } catch (error) {
      this.logger.error('Error extracting customer description:', error);
      return null;
    }
  }
  
  /**
   * Extract the AI-generated description from the HTML
   * @param {object} $ - Cheerio object
   * @returns {string} - The AI-generated description
   */
  extractAIDescription($) {
    try {
      // AI-generated description is typically in a specific section
      const description = $('.ai-description').text() || 
                          $('h2:contains("AI Analysis")').next().text() ||
                          $('strong:contains("AI Analysis")').parent().next().text() ||
                          $('.wp-block-group:contains("AI Analysis")').find('p').text();
      
      return description ? description.trim() : null;
    } catch (error) {
      this.logger.error('Error extracting AI description:', error);
      return null;
    }
  }
  
  /**
   * Extract metadata from the HTML
   * @param {object} $ - Cheerio object
   * @returns {object} - The extracted metadata
   */
  extractMetadata($) {
    try {
      // Initialize metadata object with default values
      const metadata = {
        title: null,
        detailedTitle: null,
        objectType: null,
        creator: null,
        age: null,
        materials: null,
        dimensions: null,
        condition: null,
        provenance: null
      };
      
      // Extract title from page title or main heading
      metadata.title = $('title').text().split(' | ')[0] || $('h1').first().text();
      metadata.title = metadata.title ? metadata.title.trim() : null;
      
      // Extract detailed title (often in meta description)
      metadata.detailedTitle = $('meta[name="description"]').attr('content') || 
                               $('.entry-title').text() || 
                               metadata.title;
      metadata.detailedTitle = metadata.detailedTitle ? metadata.detailedTitle.trim() : null;
      
      // Extract object type
      metadata.objectType = $('.object-type').text() || 
                           $('strong:contains("Object Type:")').parent().text().replace('Object Type:', '').trim() ||
                           null;
      
      // Extract creator/artist
      metadata.creator = $('.creator').text() || 
                         $('strong:contains("Creator:")').parent().text().replace('Creator:', '').trim() ||
                         null;
      
      // Extract age/period
      metadata.age = $('.age').text() || 
                     $('strong:contains("Age:")').parent().text().replace('Age:', '').trim() ||
                     null;
      
      // Extract materials
      metadata.materials = $('.materials').text() || 
                           $('strong:contains("Medium:")').parent().text().replace('Medium:', '').trim() ||
                           null;
      
      // Extract dimensions
      metadata.dimensions = $('.dimensions').text() || 
                           $('strong:contains("Dimensions:")').parent().text().replace('Dimensions:', '').trim() ||
                           null;
      
      // Extract condition
      metadata.condition = $('.condition').text() || 
                           $('strong:contains("Condition:")').parent().text().replace('Condition:', '').trim() ||
                           null;
      
      // Extract provenance
      metadata.provenance = $('.provenance').text() || 
                           $('strong:contains("Provenance:")').parent().text().replace('Provenance:', '').trim() ||
                           null;
      
      return metadata;
    } catch (error) {
      this.logger.error('Error extracting metadata:', error);
      return {
        title: null,
        detailedTitle: null,
        objectType: null,
        creator: null,
        age: null,
        materials: null,
        dimensions: null,
        condition: null,
        provenance: null
      };
    }
  }
}

module.exports = ContentExtractionService; 