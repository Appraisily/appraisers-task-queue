const fs = require('fs').promises;
const path = require('path');
const { createLogger } = require('./logger');

/**
 * Utility for loading and caching templates
 */
class TemplateLoader {
  constructor() {
    this.logger = createLogger('TemplateLoader');
    this.templateCache = new Map();
    this.defaultTemplatePath = path.join(__dirname, '../templates/appraisal-template.md');
  }

  /**
   * Load a template by path
   * @param {string} templatePath - Path to the template file
   * @returns {Promise<string>} - The template content
   */
  async loadTemplate(templatePath) {
    try {
      // Check if template is in cache
      if (this.templateCache.has(templatePath)) {
        this.logger.debug(`Using cached template: ${templatePath}`);
        return this.templateCache.get(templatePath);
      }

      // Load the template from file
      this.logger.info(`Loading template from ${templatePath}`);
      const templateContent = await fs.readFile(templatePath, 'utf8');
      
      // Cache the template
      this.templateCache.set(templatePath, templateContent);
      
      return templateContent;
    } catch (error) {
      this.logger.error(`Error loading template ${templatePath}:`, error);
      throw error;
    }
  }

  /**
   * Load the default template
   * @returns {Promise<string>} - The default template content
   */
  async loadDefaultTemplate() {
    return this.loadTemplate(this.defaultTemplatePath);
  }

  /**
   * Set a custom master template path
   * @param {string} templatePath - Path to the custom template
   */
  setMasterTemplatePath(templatePath) {
    this.masterTemplatePath = templatePath;
    // Clear the cache for this template
    if (this.templateCache.has(templatePath)) {
      this.templateCache.delete(templatePath);
    }
  }

  /**
   * Load the master template
   * @returns {Promise<string>} - The master template content
   */
  async loadMasterTemplate() {
    if (this.masterTemplatePath) {
      return this.loadTemplate(this.masterTemplatePath);
    }
    
    // Fall back to default template
    return this.loadDefaultTemplate();
  }

  /**
   * Clear the template cache
   */
  clearCache() {
    this.templateCache.clear();
    this.logger.debug('Template cache cleared');
  }
}

// Export a singleton instance
const templateLoader = new TemplateLoader();
module.exports = templateLoader; 