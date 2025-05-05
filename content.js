// This script runs when the extension icon is clicked to extract article information

// Function to extract article information from the current page
function extractArticleInfo() {
  // Extract the article title
  const title = document.querySelector('h1')?.textContent.trim() || document.title;
  
  // Try to get the meta description
  let snippet = document.querySelector('meta[name="description"]')?.getAttribute('content') || '';
  
  // If no meta description, get the first few paragraphs
  if (!snippet || snippet.length < 50) {
    const paragraphs = document.querySelectorAll('p');
    let contentText = '';
    
    // Collect text from the first few substantial paragraphs
    for (let i = 0; i < paragraphs.length && i < 5; i++) {
      if (paragraphs[i].textContent.length > 30) {
        contentText += paragraphs[i].textContent.trim() + ' ';
        if (contentText.length > 300) break;
      }
    }
    
    snippet = contentText.trim();
  }
  
  return {
    title,
    snippet,
    url: window.location.href
  };
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