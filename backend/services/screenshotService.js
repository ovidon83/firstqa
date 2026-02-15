/**
 * Screenshot Upload Service for GitHub
 * Handles screenshot uploads and embedding in GitHub comments
 */

const fs = require('fs').promises;
const path = require('path');
const FormData = require('form-data');
const axios = require('axios');

/**
 * Upload screenshot to GitHub (via issue comment attachments)
 * Note: GitHub doesn't have a direct API for uploading images,
 * so we'll use external storage or base64 encoding
 * 
 * For production, use AWS S3, CloudFlare R2, or Imgur
 */
async function uploadScreenshotToGitHub(screenshotPath, filename) {
  try {
    // Read screenshot
    const imageBuffer = await fs.readFile(screenshotPath);
    
    // For now, we'll use a simple approach:
    // Option 1: Upload to external service (Imgur, ImgBB)
    // Option 2: Store locally and serve via our own server
    // Option 3: Convert to base64 and embed (not recommended for large images)
    
    // We'll implement a simple local storage with public URL
    const publicDir = path.join(process.cwd(), 'public', 'test-screenshots');
    await fs.mkdir(publicDir, { recursive: true });
    
    const timestamp = Date.now();
    const safeFilename = `${timestamp}-${filename.replace(/[^a-z0-9.-]/gi, '_')}`;
    const publicPath = path.join(publicDir, safeFilename);
    
    // Copy screenshot to public directory
    await fs.copyFile(screenshotPath, publicPath);
    
    // Generate URL (assuming server is running on BASE_URL)
    const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
    const url = `${baseUrl}/test-screenshots/${safeFilename}`;
    
    console.log(`📸 Screenshot uploaded: ${url}`);
    
    return {
      url,
      path: publicPath,
      originalPath: screenshotPath
    };
  } catch (error) {
    console.error('Error uploading screenshot:', error);
    // Return null URL but don't fail
    return {
      url: null,
      path: screenshotPath,
      originalPath: screenshotPath
    };
  }
}

/**
 * Upload screenshot to ImgBB (free image hosting service)
 * Alternative to local storage for production use
 */
async function uploadToImgBB(screenshotPath, apiKey) {
  try {
    const imageBuffer = await fs.readFile(screenshotPath);
    const base64Image = imageBuffer.toString('base64');
    
    const formData = new FormData();
    formData.append('image', base64Image);
    
    const response = await axios.post(
      `https://api.imgbb.com/1/upload?key=${apiKey}`,
      formData,
      {
        headers: formData.getHeaders()
      }
    );
    
    if (response.data && response.data.data) {
      return {
        url: response.data.data.url,
        deleteUrl: response.data.data.delete_url
      };
    }
    
    throw new Error('ImgBB upload failed');
  } catch (error) {
    console.error('Error uploading to ImgBB:', error);
    return null;
  }
}

/**
 * Upload screenshot to Imgur (requires API key)
 */
async function uploadToImgur(screenshotPath, clientId) {
  try {
    const imageBuffer = await fs.readFile(screenshotPath);
    const base64Image = imageBuffer.toString('base64');
    
    const response = await axios.post(
      'https://api.imgur.com/3/image',
      {
        image: base64Image,
        type: 'base64'
      },
      {
        headers: {
          'Authorization': `Client-ID ${clientId}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    if (response.data && response.data.data) {
      return {
        url: response.data.data.link,
        deleteHash: response.data.data.deletehash
      };
    }
    
    throw new Error('Imgur upload failed');
  } catch (error) {
    console.error('Error uploading to Imgur:', error);
    return null;
  }
}

/**
 * Upload multiple screenshots and return URLs
 */
async function uploadMultipleScreenshots(screenshots) {
  const uploadPromises = screenshots.map(async (screenshot) => {
    if (!screenshot.path) {
      return { ...screenshot, url: null };
    }
    
    const filename = path.basename(screenshot.path);
    const result = await uploadScreenshotToGitHub(screenshot.path, filename);
    
    return {
      ...screenshot,
      url: result.url
    };
  });
  
  return await Promise.all(uploadPromises);
}

/**
 * Generate markdown for embedding screenshots
 */
function generateScreenshotMarkdown(screenshotUrl, altText, caption = null) {
  if (!screenshotUrl) {
    return '_Screenshot not available_';
  }
  
  let markdown = `![${altText}](${screenshotUrl})\n`;
  if (caption) {
    markdown += `_${caption}_\n`;
  }
  return markdown;
}

/**
 * Create a comparison view for before/after screenshots
 */
function generateComparisonMarkdown(beforeUrl, afterUrl, description) {
  let markdown = `<table><tr>\n`;
  markdown += `<td><img src="${beforeUrl}" width="400" /><br/><em>Before</em></td>\n`;
  markdown += `<td><img src="${afterUrl}" width="400" /><br/><em>After</em></td>\n`;
  markdown += `</tr></table>\n\n`;
  if (description) {
    markdown += `${description}\n\n`;
  }
  return markdown;
}

module.exports = {
  uploadScreenshotToGitHub,
  uploadToImgBB,
  uploadToImgur,
  uploadMultipleScreenshots,
  generateScreenshotMarkdown,
  generateComparisonMarkdown
};

