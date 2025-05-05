// Import configuration from local config file
import CONFIG from './config.local.js';

// API key handling with better security
// The key is loaded from config file and stored in Chrome's storage API
let PERPLEXITY_API_KEY = CONFIG.PERPLEXITY_API_KEY || null;

// Simple encryption function to add a basic layer of protection
function encrypt(text, salt) {
  const textToChars = text => text.split('').map(c => c.charCodeAt(0));
  const byteHex = n => ("0" + Number(n).toString(16)).substr(-2);
  const applySalt = code => textToChars(salt).reduce((a,b) => a ^ b, code);

  return text.split('')
    .map(textToChars)
    .map(applySalt)
    .map(byteHex)
    .join('');
}

// Simple decryption function
function decrypt(encoded, salt) {
  const textToChars = text => text.split('').map(c => c.charCodeAt(0));
  const applySalt = code => textToChars(salt).reduce((a,b) => a ^ b, code);
  
  return encoded.match(/.{1,2}/g)
    .map(hex => parseInt(hex, 16))
    .map(applySalt)
    .map(charCode => String.fromCharCode(charCode))
    .join('');
}

// Load the API key from storage or initialize it if not present
function initializeApiKey() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['encryptedApiKey'], function(result) {
      if (result.encryptedApiKey) {
        // Decrypt the stored key
        // Note: In a real implementation, use a more secure salt mechanism
        const salt = 'mirror-mirror-salt';
        PERPLEXITY_API_KEY = decrypt(result.encryptedApiKey, salt);
        resolve();
      } else {
        // For first-time setup, encrypt and store the key
        // In a production environment, you would get this from a secure source
        const defaultKey = "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";
        const salt = 'mirror-mirror-salt';
        const encryptedKey = encrypt(defaultKey, salt);
        
        chrome.storage.local.set({encryptedApiKey: encryptedKey}, function() {
          PERPLEXITY_API_KEY = defaultKey;
          resolve();
        });
      }
    });
  });
}

// Initialize the API key when the extension loads
initializeApiKey();

// Listen for messages from popup or content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'summarizeArticle') {
    summarizeArticle(message.articleInfo)
      .then(summary => {
        sendResponse({ success: true, summary });
      })
      .catch(error => {
        sendResponse({ success: false, error: error.message });
      });
    return true; // Required for async sendResponse
  }
  else if (message.action === 'findRelatedArticles') {
    findRelatedArticles(message.articleInfo, message.summary)
      .then(relatedArticles => {
        sendResponse({ success: true, relatedArticles });
      })
      .catch(error => {
        sendResponse({ success: false, error: error.message });
      });
    return true; // Required for async sendResponse
  }
  else if (message.action === 'analyzeArticleBias') {
    analyzeArticleBias(message.articleInfo, message.summary)
      .then(biasAnalysis => {
        sendResponse({ success: true, biasAnalysis });
      })
      .catch(error => {
        sendResponse({ success: false, error: error.message });
      });
    return true; // Required for async sendResponse
  }
  else if (message.action === 'clearCacheEntry') {
    const cacheKey = message.cacheKey;
    if (cacheKey) {
      // Clear specific cache entries
      if (resultsCache.summaries[cacheKey]) delete resultsCache.summaries[cacheKey];
      if (resultsCache.biasAnalyses[cacheKey]) delete resultsCache.biasAnalyses[cacheKey];
      if (resultsCache.relatedArticles[cacheKey]) delete resultsCache.relatedArticles[cacheKey];
      
      // Update storage
      chrome.storage.local.set({
        'summaryCache': resultsCache.summaries,
        'biasCache': resultsCache.biasAnalyses,
        'articlesCache': resultsCache.relatedArticles
      });
      
      console.log(`Cache cleared for: ${cacheKey}`);
      sendResponse({ success: true });
    } else {
      sendResponse({ success: false, error: 'No cache key provided' });
    }
    return true;
  }
});

async function summarizeArticle(articleInfo) {
  try {
    // Ensure API key is initialized before making the request
    if (!PERPLEXITY_API_KEY) {
      await initializeApiKey();
    }
    
    const response = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${PERPLEXITY_API_KEY}`
      },
      body: JSON.stringify({
        model: "sonar-pro",
        messages: [
          {
            role: "system",
            content: "You are a helpful assistant that summarizes articles concisely. Provide a brief summary in 2-3 sentences."
          },
          {
            role: "user",
            content: `Summarize this article: "${articleInfo.title}". Content: "${articleInfo.snippet}"`
          }
        ]
      })
    });
    
    const data = await response.json();
    
    // Extract the summary from the response
    const summary = data.choices[0].message.content;
    return summary;
  } catch (error) {
    console.error('Error summarizing article:', error);
    throw error;
  }
}

async function findRelatedArticles(articleInfo, summary, attempt = 1, maxAttempts = 3) {
  try {
    // Ensure API key is initialized before making the request
    if (!PERPLEXITY_API_KEY) {
      await initializeApiKey();
    }
    
    // Different prompts for different attempts to get better results
    let userPrompt;
    let systemPrompt;
    
    if (attempt === 1) {
      systemPrompt = "You are a helpful assistant that finds related news articles on the same topic. Return results in JSON format with title, source, and URL for each article. Always aim to return 5 articles.";
      userPrompt = `Find 5 other news sources covering this topic. Article title: "${articleInfo.title}". Summary: "${summary}". Original URL: ${articleInfo.url}`;
    } else if (attempt === 2) {
      systemPrompt = "You are a helpful assistant that finds related news articles on the same topic. Return results in JSON format with title, source, and URL for each article. Return at least 3-5 articles if possible.";
      userPrompt = `Find 5 different news articles about "${articleInfo.title}". Use broader search terms and include recent coverage of this topic. Return only articles from reputable news sources.`;
    } else {
      systemPrompt = "You are a helpful assistant that finds news articles related to a topic. Return results in JSON format with title, source, and URL for each article. Even finding just 1-2 related articles is helpful.";
      userPrompt = `Find ANY news articles related to the following topics extracted from this article: "${extractKeyTopics(articleInfo.title, summary)}". Return results from any reputable news outlets published in the last year. Even just 1 or 2 articles is fine.`;
    }
    
    const response = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${PERPLEXITY_API_KEY}`
      },
      body: JSON.stringify({
        model: "sonar-pro",
        messages: [
          {
            role: "system",
            content: systemPrompt
          },
          {
            role: "user",
            content: userPrompt
          }
        ]
      })
    });
    
    const data = await response.json();
    
    // Parse the response to extract the related articles
    const content = data.choices[0].message.content;
    let relatedArticles;
    
    try {
      // Try to parse if it's directly JSON
      relatedArticles = JSON.parse(content);
    } catch (e) {
      // If not direct JSON, try to extract JSON from the text
      const jsonMatch = content.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
      if (jsonMatch) {
        relatedArticles = JSON.parse(jsonMatch[0]);
      } else {
        // Fallback to simple parsing
        relatedArticles = {
          articles: content.split('\n\n').map(article => {
            const lines = article.split('\n');
            return {
              title: lines[0]?.replace(/^[0-9]+\.\s*/, '') || 'Unknown Title',
              source: lines[1]?.replace(/^Source:\s*/, '') || 'Unknown Source',
              url: lines[2]?.replace(/^URL:\s*/, '') || '#'
            };
          })
        };
      }
    }
    
    // Check if we found any articles
    const articles = relatedArticles.articles || relatedArticles;
    
    // If no articles found and we haven't reached max attempts, try again with a different prompt
    if ((!articles || articles.length === 0) && attempt < maxAttempts) {
      console.log(`No articles found on attempt ${attempt}, trying again...`);
      return findRelatedArticles(articleInfo, summary, attempt + 1, maxAttempts);
    }
    
    // If we found at least one article, return the results
    if (articles && articles.length > 0) {
      return relatedArticles;
    }
    
    // If we've tried all attempts and still have no articles, make one final attempt
    // with an extremely broad search
    if (attempt >= maxAttempts) {
      console.log("Making final attempt with extremely broad search...");
      
      const finalResponse = await fetch('https://api.perplexity.ai/chat/completions', {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${PERPLEXITY_API_KEY}`
        },
        body: JSON.stringify({
          model: "sonar-pro",
          messages: [
            {
              role: "system",
              content: "You are a helpful assistant that finds news articles. Return ANY remotely relevant news articles in JSON format with title, source, and URL. Even a single article is acceptable."
            },
            {
              role: "user",
              content: `Find ANY news articles that might be even loosely related to these keywords: ${extractKeyTopics(articleInfo.title, summary)}. Or find recent popular news articles on any topic if nothing related can be found. Just return something interesting for the user to read.`
            }
          ]
        })
      });
      
      const finalData = await finalResponse.json();
      const finalContent = finalData.choices[0].message.content;
      
      try {
        // Try to parse the final response
        return JSON.parse(finalContent);
      } catch (e) {
        // Last resort parsing
        const jsonMatch = finalContent.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
        if (jsonMatch) {
          return JSON.parse(jsonMatch[0]);
        } else {
          // Create a simple structure with whatever we got
          return {
            articles: [
              {
                title: "Suggested Reading",
                source: "Recommended by AI",
                url: "https://news.google.com/"
              }
            ]
          };
        }
      }
    }
    
    return relatedArticles;
  } catch (error) {
    console.error(`Error finding related articles (attempt ${attempt}):`, error);
    
    // If there's an error and we haven't reached max attempts, try again
    if (attempt < maxAttempts) {
      console.log(`Error on attempt ${attempt}, trying again...`);
      return findRelatedArticles(articleInfo, summary, attempt + 1, maxAttempts);
    }
    
    // If all attempts failed, return a fallback response
    return {
      articles: [
        {
          title: "Could not find related articles",
          source: "Try a different page or check your internet connection",
          url: "#"
        }
      ]
    };
  }
}

// Helper function to extract key topics from title and summary
function extractKeyTopics(title, summary) {
  // Simple extraction of potential keywords
  const combinedText = `${title} ${summary}`;
  
  // Remove common words and punctuation
  const cleanedText = combinedText
    .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, "")
    .replace(/\s{2,}/g, " ")
    .toLowerCase();
  
  // Split into words
  const words = cleanedText.split(" ");
  
  // Filter out common words (simple approach)
  const commonWords = ["the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for", "with", "by", "about", "as", "of", "from"];
  const keywords = words.filter(word => word.length > 3 && !commonWords.includes(word));
  
  // Get unique keywords
  const uniqueKeywords = [...new Set(keywords)];
  
  // Return top keywords (up to 10)
  return uniqueKeywords.slice(0, 10).join(", ");
}

// Bias analysis temporarily disabled
/*
async function analyzeArticleBias(articleInfo, summary) {
  try {
    const response = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${PERPLEXITY_API_KEY}`
      },
      body: JSON.stringify({
        model: "sonar-pro",
        messages: [
          {
            role: "system",
            content: "You are a neutral media analyst who evaluates political bias in news articles. Analyze the article objectively without inserting your own political views. Return results in JSON format with a bias_score from -10 (strongly left-leaning) to +10 (strongly right-leaning), with 0 being neutral. Include evidence_points as an array of specific phrases or framing choices that support your assessment."
          },
          {
            role: "user",
            content: `Analyze this article for political bias: Title: "${articleInfo.title}". Content: "${articleInfo.snippet}". Summary: "${summary}". Provide a bias_score from -10 to +10 and list specific evidence for your rating.`
          }
        ]
      })
    });
    
    const data = await response.json();
    
    // Parse the response to extract the bias analysis
    const content = data.choices[0].message.content;
    let biasAnalysis;
    
    try {
      // Try to parse if it's directly JSON
      biasAnalysis = JSON.parse(content);
    } catch (e) {
      // If not direct JSON, try to extract JSON from the text
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        biasAnalysis = JSON.parse(jsonMatch[0]);
      } else {
        // Fallback to simple parsing
        biasAnalysis = {
          bias_score: 0,
          evidence_points: ["Could not parse detailed analysis"],
          explanation: content
        };
      }
    }
    
    return biasAnalysis;
  } catch (error) {
    console.error('Error analyzing article bias:', error);
    throw error;
  }
}
*/

// Placeholder function that returns a neutral bias without making API calls
async function analyzeArticleBias(articleInfo, summary) {
  return {
    bias_score: 0,
    evidence_points: ["Bias analysis is currently disabled"],
    explanation: "The bias analysis feature has been temporarily disabled."
  };
} 