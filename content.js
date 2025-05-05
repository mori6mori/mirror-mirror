// This script runs when the extension icon is clicked to extract article information

// Function to classify the current page type
function classifyPage() {
  const url = window.location.href;
  const domain = window.location.hostname;
  
  // Page type classification object
  let pageType = {
    type: 'unknown',  // Default type
    confidence: 0,    // Confidence score (0-100)
    details: {}       // Additional details specific to the content type
  };
  
  // Check URL patterns
  if (url.includes('youtube.com/watch')) {
    pageType.type = 'video';
    pageType.subtype = 'youtube';
    pageType.confidence = 90;
  } else if (url.includes('tiktok.com') && url.includes('/video/')) {
    pageType.type = 'video';
    pageType.subtype = 'tiktok';
    pageType.confidence = 90;
  } else if (url.includes('instagram.com/reel/')) {
    pageType.type = 'video';
    pageType.subtype = 'instagram_reel';
    pageType.confidence = 90;
  } else if (url.includes('twitter.com') || url.includes('x.com')) {
    pageType.type = 'social';
    pageType.subtype = 'twitter';
    pageType.confidence = 80;
  }
  
  // Check meta tags
  const ogType = document.querySelector('meta[property="og:type"]')?.getAttribute('content');
  if (ogType) {
    pageType.details.ogType = ogType;
    
    if (ogType === 'article' && pageType.type === 'unknown') {
      pageType.type = 'article';
      pageType.confidence = Math.max(pageType.confidence, 70);
    } else if (ogType === 'video' && pageType.type === 'unknown') {
      pageType.type = 'video';
      pageType.confidence = Math.max(pageType.confidence, 70);
    }
  }
  
  // Check for schema.org markup
  const schemaElements = document.querySelectorAll('[itemtype]');
  for (const element of schemaElements) {
    const itemType = element.getAttribute('itemtype');
    if (itemType) {
      pageType.details.schemaType = itemType;
      
      if (itemType.includes('schema.org/Article') && pageType.confidence < 80) {
        pageType.type = 'article';
        pageType.confidence = 80;
      } else if (itemType.includes('schema.org/NewsArticle') && pageType.confidence < 85) {
        pageType.type = 'article';
        pageType.subtype = 'news';
        pageType.confidence = 85;
      } else if (itemType.includes('schema.org/VideoObject') && pageType.confidence < 80) {
        pageType.type = 'video';
        pageType.confidence = 80;
      }
    }
  }
  
  // Check for common article indicators
  if (pageType.type === 'unknown') {
    const hasArticleElement = document.querySelector('article') !== null;
    const hasMultipleParagraphs = document.querySelectorAll('p').length > 3;
    
    if (hasArticleElement && hasMultipleParagraphs) {
      pageType.type = 'article';
      pageType.confidence = 60;
    }
  }
  
  // Check for news domains
  const newsDomains = ['nytimes.com', 'wsj.com', 'washingtonpost.com', 'bbc.com', 'cnn.com', 'foxnews.com', 'reuters.com', 'bloomberg.com'];
  if (newsDomains.some(domain => window.location.hostname.includes(domain))) {
    if (pageType.type === 'unknown' || pageType.type === 'article') {
      pageType.type = 'article';
      pageType.subtype = 'news';
      pageType.confidence = Math.max(pageType.confidence, 75);
    }
  }
  
  // If still unknown but has substantial text, classify as generic article
  if (pageType.type === 'unknown') {
    const textContent = document.body.innerText;
    if (textContent.length > 2000) { // Arbitrary threshold for "substantial" content
      pageType.type = 'article';
      pageType.subtype = 'generic';
      pageType.confidence = 40;
    }
  }
  
  return pageType;
}

// Function to extract article information from the current page
function extractArticleInfo() {
  // Get the page classification
  const pageClassification = classifyPage();
  
  // Extract the article title
  const title = document.querySelector('h1')?.textContent.trim() || document.title;
  
  // Try to get the meta description
  let snippet = document.querySelector('meta[name="description"]')?.getAttribute('content') || '';
  
  // If no meta description, get content based on page type
  if (!snippet || snippet.length < 50) {
    snippet = extractContentByType(pageClassification);
  }
  
  return {
    title,
    snippet,
    url: window.location.href,
    pageClassification
  };
}

// Extract content based on the page type
function extractContentByType(pageClassification) {
  const type = pageClassification.type;
  const subtype = pageClassification.subtype;
  
  if (type === 'video') {
    if (subtype === 'youtube') {
      return extractYouTubeContent();
    } else if (subtype === 'tiktok') {
      return extractTikTokContent();
    } else if (subtype === 'instagram_reel') {
      return extractInstagramContent();
    }
  }
  
  // Default to article extraction for unknown or article types
  return extractArticleContent();
}

// Extract content from a standard article
function extractArticleContent() {
  const paragraphs = document.querySelectorAll('p');
  let contentText = '';
  
  // Collect text from the first few substantial paragraphs
  for (let i = 0; i < paragraphs.length && i < 10; i++) {
    if (paragraphs[i].textContent.length > 30) {
      contentText += paragraphs[i].textContent.trim() + ' ';
      if (contentText.length > 500) break;
    }
  }
  
  return contentText.trim();
}

// Extract content from YouTube
function extractYouTubeContent() {
  // Try to get video description
  const description = document.querySelector('#description-text')?.textContent || '';
  
  // Try to find transcript if available
  const transcriptButton = Array.from(document.querySelectorAll('button')).find(button => 
    button.textContent.toLowerCase().includes('transcript') || 
    button.textContent.toLowerCase().includes('show transcript')
  );
  
  // Note: Actually opening the transcript would require user interaction or more complex handling
  // This is just a basic implementation
  
  return description || 'YouTube video. Transcript not automatically accessible.';
}

// Extract content from TikTok
function extractTikTokContent() {
  // Try to get video caption
  const caption = document.querySelector('.tiktok-1ejylhp-DivContainer.e11995xo0')?.textContent || '';
  
  return caption || 'TikTok video. Caption not found.';
}

// Extract content from Instagram
function extractInstagramContent() {
  // Try to get post caption
  const caption = document.querySelector('._a9zs')?.textContent || '';
  
  return caption || 'Instagram reel. Caption not found.';
}

// Listen for messages from the extension
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'extractArticleInfo') {
    const articleInfo = extractArticleInfo();
    sendResponse(articleInfo);
  }
  return true; // Keep the message channel open for async response
});

// Let the extension know that the content script is loaded
chrome.runtime.sendMessage({ action: 'contentScriptReady' }); 