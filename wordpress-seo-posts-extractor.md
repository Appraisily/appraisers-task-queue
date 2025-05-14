# WordPress SEO Posts Extractor

This document outlines the implementation plan for extracting SEO category posts from WordPress and incorporating them into the UGO site.

## Overview

The goal is to:
1. Connect to the WordPress API
2. List all posts in the SEO category
3. Download each post's content and associated images
4. Prepare the data for Claude 3.7 API integration
5. Upload the content as articles to the UGO site

## Implementation Details

### 1. WordPress Authentication and Configuration

The repository already has WordPress integration set up with proper authentication. We'll use these existing components:

```javascript
// WordPress credentials are stored in Secret Manager
const secrets = {
  WORDPRESS_API_URL: 'WORDPRESS_API_URL',  // Secret name
  WORDPRESS_USERNAME: 'wp_username',       // Secret name
  WORDPRESS_APP_PASSWORD: 'wp_app_password' // Secret name
};

// Authentication is done using Basic Auth with base64 encoding
const credentials = Buffer.from(`${username}:${appPassword}`).toString('base64');
const authHeader = `Basic ${credentials}`;

// Headers configuration for WordPress API requests
const headers = {
  'Accept': 'application/json',
  'Content-Type': 'application/json',
  'Authorization': authHeader
};
```

### 2. Listing SEO Category Posts

WordPress REST API provides endpoints to list posts by category. We'll need the category ID for "SEO":

```javascript
// Get SEO category ID first (we need to find the SEO category ID)
async function getSEOCategoryId() {
  const categoriesUrl = `${apiUrl}/categories?search=SEO`;
  const response = await fetch(categoriesUrl, { headers });
  const categories = await response.json();
  
  // Find the SEO category by name
  const seoCategory = categories.find(cat => 
    cat.name.toLowerCase() === 'seo' || 
    cat.slug.toLowerCase() === 'seo'
  );
  
  if (!seoCategory) {
    throw new Error('SEO category not found');
  }
  
  return seoCategory.id;
}

// Then get all posts in the SEO category
async function getSEOPosts(categoryId) {
  let page = 1;
  const perPage = 20;
  let allPosts = [];
  let hasMorePosts = true;
  
  while (hasMorePosts) {
    const postsUrl = `${apiUrl}/posts?categories=${categoryId}&page=${page}&per_page=${perPage}`;
    const response = await fetch(postsUrl, { headers });
    
    // Check if we've reached the end of the posts
    if (response.status === 400 || response.status === 404) {
      hasMorePosts = false;
      break;
    }
    
    const posts = await response.json();
    
    if (posts.length === 0) {
      hasMorePosts = false;
    } else {
      allPosts = [...allPosts, ...posts];
      page++;
    }
  }
  
  return allPosts;
}
```

### 3. Downloading Post Content and Images

For each post, we need to download the content and all associated images:

```javascript
async function downloadPost(post) {
  // Get full post data
  const postUrl = `${apiUrl}/posts/${post.id}?_embed=true`;
  const response = await fetch(postUrl, { headers });
  const fullPost = await response.json();
  
  // Extract content
  const content = fullPost.content.rendered;
  
  // Extract and download featured image if it exists
  let featuredImage = null;
  if (fullPost.featured_media && fullPost._embedded && 
      fullPost._embedded['wp:featuredmedia']) {
    const media = fullPost._embedded['wp:featuredmedia'][0];
    featuredImage = {
      id: media.id,
      url: media.source_url,
      alt: media.alt_text,
      data: await downloadImage(media.source_url)
    };
  }
  
  // Extract and download images from content
  const contentImages = [];
  const imgRegex = /<img[^>]+src="([^">]+)"/g;
  let match;
  
  while (match = imgRegex.exec(content)) {
    const imageUrl = match[1];
    try {
      contentImages.push({
        url: imageUrl,
        data: await downloadImage(imageUrl)
      });
    } catch (error) {
      console.error(`Failed to download image ${imageUrl}:`, error);
    }
  }
  
  return {
    id: fullPost.id,
    title: fullPost.title.rendered,
    content: fullPost.content.rendered,
    excerpt: fullPost.excerpt.rendered,
    date: fullPost.date,
    modified: fullPost.modified,
    slug: fullPost.slug,
    featuredImage,
    contentImages,
    author: fullPost.author,
    categories: fullPost.categories,
    tags: fullPost.tags,
    meta: fullPost.meta || {}
  };
}

async function downloadImage(url) {
  const response = await fetch(url);
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
```

### 4. Preparing Data for Claude 3.7

We'll create a structured format for Claude 3.7:

```javascript
function prepareForClaude(post) {
  return {
    title: post.title,
    content: sanitizeContent(post.content),
    images: [
      ...(post.featuredImage ? [{ 
        url: post.featuredImage.url, 
        alt: post.featuredImage.alt,
        isFeatured: true
      }] : []),
      ...post.contentImages.map(img => ({
        url: img.url,
        alt: '',
        isFeatured: false
      }))
    ],
    metadata: {
      originalId: post.id,
      originalSource: 'WordPress',
      originalPublishDate: post.date,
      originalModifiedDate: post.modified,
      originalSlug: post.slug,
      categories: post.categories,
      tags: post.tags
    }
  };
}

function sanitizeContent(html) {
  // Remove WordPress specific classes, scripts, etc.
  // This is a simplified example - you might need more complex processing
  let content = html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/class="[^"]*"/gi, '')
    .replace(/style="[^"]*"/gi, '');
    
  return content;
}
```

### 5. API Integration with Claude 3.7 for UGO Site

The final step is to integrate with Claude 3.7 and upload to the UGO site:

```javascript
async function processWithClaude(postData) {
  // Assuming there's an existing Claude service in the codebase
  // This is a placeholder for the actual implementation
  const claudeService = new ClaudeService();
  
  // Process the content with Claude 3.7
  const enhancedContent = await claudeService.enhanceContent({
    text: postData.content,
    title: postData.title,
    mode: 'article',
    targetSite: 'UGO'
  });
  
  return {
    ...postData,
    enhancedContent
  };
}

async function uploadToUGOSite(processedPost) {
  // Implementation to upload the post to UGO site via API
  // This is a placeholder for the actual implementation
  const ugoService = new UGOService();
  
  // Upload images first
  const uploadedImages = await Promise.all(
    processedPost.images.map(async image => {
      const uploadResult = await ugoService.uploadImage(image.data);
      return {
        ...image,
        ugoUrl: uploadResult.url,
        ugoId: uploadResult.id
      };
    })
  );
  
  // Replace image URLs in content
  let contentWithUpdatedImages = processedPost.enhancedContent;
  uploadedImages.forEach(image => {
    contentWithUpdatedImages = contentWithUpdatedImages.replace(
      new RegExp(image.url, 'g'),
      image.ugoUrl
    );
  });
  
  // Create the article
  const articleResult = await ugoService.createArticle({
    title: processedPost.title,
    content: contentWithUpdatedImages,
    featuredImage: uploadedImages.find(img => img.isFeatured)?.ugoId,
    metadata: processedPost.metadata
  });
  
  return articleResult;
}
```

## Complete Implementation Flow

Here's the complete flow for the extraction and migration process:

```javascript
async function extractAndMigrateSEOPosts() {
  // 1. Initialize WordPress service
  await initializeWordPressService();
  
  // 2. Get SEO category ID
  const seoCategoryId = await getSEOCategoryId();
  console.log(`Found SEO category ID: ${seoCategoryId}`);
  
  // 3. Get all posts in the SEO category
  const seoPosts = await getSEOPosts(seoCategoryId);
  console.log(`Found ${seoPosts.length} posts in the SEO category`);
  
  // 4. Process each post
  const results = [];
  for (const post of seoPosts) {
    try {
      console.log(`Processing post ${post.id}: ${post.title.rendered}`);
      
      // Download post with content and images
      const downloadedPost = await downloadPost(post);
      
      // Prepare data for Claude
      const preparedData = prepareForClaude(downloadedPost);
      
      // Process with Claude 3.7
      const processedPost = await processWithClaude(preparedData);
      
      // Upload to UGO site
      const uploadResult = await uploadToUGOSite(processedPost);
      
      results.push({
        id: post.id,
        title: post.title.rendered,
        status: 'success',
        ugoArticleId: uploadResult.id,
        ugoArticleUrl: uploadResult.url
      });
      
      console.log(`Successfully migrated post ${post.id} to UGO site`);
    } catch (error) {
      console.error(`Failed to process post ${post.id}:`, error);
      results.push({
        id: post.id,
        title: post.title.rendered,
        status: 'error',
        error: error.message
      });
    }
  }
  
  // 5. Generate final report
  console.log('Migration completed!');
  console.log(`Total posts: ${seoPosts.length}`);
  console.log(`Successful migrations: ${results.filter(r => r.status === 'success').length}`);
  console.log(`Failed migrations: ${results.filter(r => r.status === 'error').length}`);
  
  return results;
}
```

## Required Environment Variables

The service will need these environment variables (or secrets):

```
WORDPRESS_API_URL=https://your-wordpress-site.com/wp-json/wp/v2
WORDPRESS_USERNAME=your_username
WORDPRESS_APP_PASSWORD=your_app_password
CLAUDE_API_KEY=your_claude_api_key
UGO_API_URL=https://your-ugo-site.com/api
UGO_API_KEY=your_ugo_api_key
```

## Next Steps

1. Implement the service as outlined above
2. Add proper error handling and retry logic
3. Add progress tracking for long-running operations
4. Consider implementing batch processing to handle large volumes of posts
5. Implement proper logging for debugging and audit purposes
6. Add a CLI interface for easy execution

## Notes

- This implementation leverages the existing WordPress integration in the repository
- The WordPress API endpoints might need adjustments depending on your WordPress setup
- Image processing might require additional handling for different formats and sizes
- Consider rate limiting to avoid overwhelming either WordPress or the UGO site APIs 