const fetch = require('node-fetch');
const sharp = require('sharp');
const { createLogger } = require('../utils/logger');

class PDFService {
  constructor() {
    this.logger = createLogger('PDF');
    this.baseUrl = 'https://appraisals-backend-856401495068.us-central1.run.app';
    this.timeout = 120000; // 2 minutes timeout
    this.maxRetries = 3;
    this.retryDelay = 5000; // 5 seconds between retries
    this.imageConfig = {
      main: { width: 1200, quality: 80 },
      signature: { width: 600, quality: 80 },
      age: { width: 800, quality: 80 }
    };
  }

  async initialize() {
    return Promise.resolve();
  }

  async optimizeImage(url, config) {
    try {
      const response = await fetch(url);
      const buffer = await response.buffer();
      
      return sharp(buffer)
        .resize(config.width, null, { 
          withoutEnlargement: true,
          fit: 'inside'
        })
        .jpeg({ quality: config.quality })
        .toBuffer();
    } catch (error) {
      this.logger.error(`Error optimizing image: ${error.message}`);
      throw error;
    }
  }

  async generatePDF(postId, sessionId) {
    this.logger.info(`Generating PDF for post ${postId}`);
    
    let lastError;
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeout);

        // Get the WordPress post data first
        const postResponse = await fetch(`${this.baseUrl}/wp/v2/posts/${postId}`);
        if (!postResponse.ok) {
          throw new Error(`Failed to fetch post data: ${postResponse.statusText}`);
        }
        const post = await postResponse.json();

        // Extract image URLs from post content
        const mainImage = post.acf?.main_image?.url;
        const signatureImage = post.acf?.signature_image?.url;
        const ageImage = post.acf?.age_image?.url;

        // Optimize images in parallel
        const [optimizedMain, optimizedSignature, optimizedAge] = await Promise.all([
          mainImage ? this.optimizeImage(mainImage, this.imageConfig.main) : null,
          signatureImage ? this.optimizeImage(signatureImage, this.imageConfig.signature) : null,
          ageImage ? this.optimizeImage(ageImage, this.imageConfig.age) : null
        ]);

        // Create FormData with optimized images
        const formData = new FormData();
        formData.append('postId', postId);
        formData.append('session_ID', sessionId);
        if (optimizedMain) formData.append('main_image', new Blob([optimizedMain], { type: 'image/jpeg' }));
        if (optimizedSignature) formData.append('signature_image', new Blob([optimizedSignature], { type: 'image/jpeg' }));
        if (optimizedAge) formData.append('age_image', new Blob([optimizedAge], { type: 'image/jpeg' }));

        const response = await fetch(`${this.baseUrl}/generate-pdf`, {
          method: 'POST',
          body: formData,
          signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          throw new Error(`PDF generation failed: ${response.statusText}`);
        }

        const data = await response.json();
        this.logger.info(`PDF generated successfully for post ${postId}`);
        
        return {
          pdfLink: data.pdfLink,
          docLink: data.docLink
        };
      } catch (error) {
        lastError = error;
        this.logger.warn(`PDF generation attempt ${attempt} failed:`, error.message);
        
        if (attempt < this.maxRetries) {
          this.logger.info(`Retrying in ${this.retryDelay/1000} seconds...`);
          await new Promise(resolve => setTimeout(resolve, this.retryDelay));
        }
      }
    }

    throw new Error(`PDF generation failed after ${this.maxRetries} attempts: ${lastError.message}`);
  }
}

module.exports = PDFService;