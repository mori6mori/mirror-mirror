document.addEventListener('DOMContentLoaded', function() {
  const currentArticleDiv = document.getElementById('current-article');
  const summaryDiv = document.getElementById('article-summary');
  const relatedArticlesDiv = document.getElementById('related-articles');
  
  // Show loading state
  currentArticleDiv.innerHTML = '<div class="loading">Extracting article information...</div>';
  summaryDiv.innerHTML = '<div class="loading">Waiting...</div>';
  relatedArticlesDiv.innerHTML = '<div class="loading">Please wait...</div>';
  
  // Get the current tab and extract article info
  chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
    if (!tabs || tabs.length === 0) {
      showError("Could not access the current tab.");
      return;
    }
    
    const activeTab = tabs[0];
    
    // Check if we can inject the content script
    chrome.scripting.executeScript({
      target: { tabId: activeTab.id },
      function: function() {
        return true; // Just to check if we can execute scripts on this page
      }
    }).then(() => {
      // Now try to send a message to the content script
      chrome.tabs.sendMessage(activeTab.id, {action: 'extractArticleInfo'}, function(articleInfo) {
        if (chrome.runtime.lastError) {
          // If there's an error, inject the content script and try again
          console.log("Content script not ready, injecting it now:", chrome.runtime.lastError.message);
          
          chrome.scripting.executeScript({
            target: { tabId: activeTab.id },
            files: ['content.js']
          }).then(() => {
            // Wait a moment for the script to initialize
            setTimeout(() => {
              // Try again to get article info
              chrome.tabs.sendMessage(activeTab.id, {action: 'extractArticleInfo'}, handleArticleInfo);
            }, 500);
          }).catch(err => {
            showError(`Could not inject content script: ${err.message}`);
          });
        } else {
          // Content script responded normally
          handleArticleInfo(articleInfo);
        }
      });
    }).catch(err => {
      showError(`Cannot access this page: ${err.message}. The extension may not have permission to run on this page.`);
    });
  });
  
  function handleArticleInfo(articleInfo) {
    if (!articleInfo) {
      showError("Could not extract article information from this page.");
      return;
    }
    
    // Display the current article info
    currentArticleDiv.innerHTML = `
      <div class="article-title">${articleInfo.title}</div>
      <div class="article-source">Current page: <a href="${articleInfo.url}" target="_blank">${new URL(articleInfo.url).hostname}</a></div>
    `;
    
    // Display the page classification info
    displayPageClassification(articleInfo.pageClassification);
    
    // First, get a summary of the article
    chrome.runtime.sendMessage(
      {
        action: 'summarizeArticle',
        articleInfo: articleInfo
      },
      function(summaryResponse) {
        if (summaryResponse && summaryResponse.success) {
          // Display the summary
          summaryDiv.innerHTML = `
            <div class="summary-content">${summaryResponse.summary}</div>
          `;
          
          // Skip bias analysis since it's been disabled in the UI
          // analyzeBias(articleInfo, summaryResponse.summary);
          
          // Now, find related articles using the summary
          chrome.runtime.sendMessage(
            {
              action: 'findRelatedArticles',
              articleInfo: articleInfo,
              summary: summaryResponse.summary
            },
            function(relatedResponse) {
              if (relatedResponse && relatedResponse.success) {
                displayRelatedArticles(relatedResponse.relatedArticles);
              } else {
                relatedArticlesDiv.innerHTML = `
                  <div class="error">
                    Error finding related articles: ${relatedResponse?.error || 'Unknown error'}
                  </div>
                `;
              }
            }
          );
        } else {
          summaryDiv.innerHTML = `
            <div class="error">
              Error generating summary: ${summaryResponse?.error || 'Unknown error'}
            </div>
          `;
          relatedArticlesDiv.innerHTML = '';
        }
      }
    );
  }
  
  function showError(message) {
    currentArticleDiv.innerHTML = `<div class="error">${message}</div>`;
    summaryDiv.innerHTML = '';
    relatedArticlesDiv.innerHTML = '';
  }
  
  function displayPageClassification(classification) {
    const contentTypeDiv = document.getElementById('content-type');
    
    if (!classification) {
      contentTypeDiv.innerHTML = `<div>Unable to classify content</div>`;
      return;
    }
    
    // Get the main type and subtype
    const type = classification.type || 'unknown';
    const subtype = classification.subtype || '';
    const confidence = classification.confidence || 0;
    
    // Format the type for display
    const formattedType = type.charAt(0).toUpperCase() + type.slice(1);
    const formattedSubtype = subtype ? ` (${subtype})` : '';
    
    // Create the HTML for the content type display
    let html = `
      <div>
        <span class="content-type-badge type-${type}">${formattedType}${formattedSubtype}</span>
      </div>
    `;
    
    // Details section removed as requested
    // Uncomment if you want to display metadata details again
    /*
    if (classification.details && Object.keys(classification.details).length > 0) {
      html += `<div class="classification-details" style="font-size: 0.8em; margin-top: 8px; color: #666;">`;
      
      for (const [key, value] of Object.entries(classification.details)) {
        html += `<div>${key}: ${value}</div>`;
      }
      
      html += `</div>`;
    }
    */
    
    contentTypeDiv.innerHTML = html;
  }
  
  function displayRelatedArticles(data) {
    // Clear the loading message
    relatedArticlesDiv.innerHTML = '';
    
    // Check the structure of the data and adapt accordingly
    const articles = data.articles || data;
    
    if (Array.isArray(articles) && articles.length > 0) {
      articles.forEach(article => {
        const articleElement = document.createElement('div');
        articleElement.className = 'related-article';
        
        // Extract hostname from URL for display
        let hostname = '';
        try {
          hostname = new URL(article.url).hostname;
        } catch (e) {
          hostname = article.source || 'Unknown source';
        }
        
        articleElement.innerHTML = `
          <div class="article-title">
            <a href="${article.url}" target="_blank">${article.title}</a>
          </div>
          <div class="article-source">${article.source || hostname}</div>
        `;
        
        relatedArticlesDiv.appendChild(articleElement);
      });
    } else {
      relatedArticlesDiv.innerHTML = `
        <div class="error">No related articles found.</div>
      `;
    }
  }
  
  function analyzeBias(articleInfo, summary) {
    const biasAnalysisDiv = document.getElementById('bias-analysis');
    const biasEvidenceDiv = document.getElementById('bias-evidence');
    const biasMarker = document.getElementById('bias-marker');
    
    biasAnalysisDiv.innerHTML = '<div class="loading">Analyzing political bias...</div>';
    
    chrome.runtime.sendMessage(
      {
        action: 'analyzeArticleBias',
        articleInfo: articleInfo,
        summary: summary
      },
      function(response) {
        if (response && response.success) {
          const biasData = response.biasAnalysis;
          
          // Calculate position on spectrum (convert -10 to +10 scale to 0-100%)
          const position = ((biasData.bias_score + 10) / 20) * 100;
          
          // Update the marker position
          biasMarker.style.left = `${position}%`;
          
          // Display the bias score
          let biasLabel = "Neutral";
          if (biasData.bias_score < -7) biasLabel = "Strongly Left-Leaning";
          else if (biasData.bias_score < -3) biasLabel = "Moderately Left-Leaning";
          else if (biasData.bias_score < -1) biasLabel = "Slightly Left-Leaning";
          else if (biasData.bias_score <= 1) biasLabel = "Neutral";
          else if (biasData.bias_score < 4) biasLabel = "Slightly Right-Leaning";
          else if (biasData.bias_score < 8) biasLabel = "Moderately Right-Leaning";
          else biasLabel = "Strongly Right-Leaning";
          
          biasAnalysisDiv.innerHTML = `
            <div class="bias-score">Bias Rating: ${biasLabel} (${biasData.bias_score})</div>
          `;
          
          // Display evidence points
          if (biasData.evidence_points && biasData.evidence_points.length > 0) {
            let evidenceHtml = '<h4>Evidence:</h4><ul>';
            biasData.evidence_points.forEach(point => {
              evidenceHtml += `<li>${point}</li>`;
            });
            evidenceHtml += '</ul>';
            
            if (biasData.explanation) {
              evidenceHtml += `<p>${biasData.explanation}</p>`;
            }
            
            biasEvidenceDiv.innerHTML = evidenceHtml;
          } else {
            biasEvidenceDiv.innerHTML = '<p>No specific evidence points provided.</p>';
          }
        } else {
          biasAnalysisDiv.innerHTML = `
            <div class="error">
              Error analyzing bias: ${response?.error || 'Unknown error'}
            </div>
          `;
          biasEvidenceDiv.innerHTML = '';
        }
      }
    );
  }
  
  // Function to show a small indicator that results are from cache
  function showCachedIndicator(elementId) {
    const element = document.getElementById(elementId);
    if (element) {
      const cachedBadge = document.createElement('span');
      cachedBadge.className = 'cached-badge';
      cachedBadge.textContent = 'Cached';
      element.appendChild(cachedBadge);
    }
  }
  
  // Add a refresh button to force new results
  function addRefreshButton() {
    const container = document.querySelector('.container');
    const refreshButton = document.createElement('button');
    refreshButton.id = 'refresh-button';
    refreshButton.textContent = 'Refresh Analysis';
    refreshButton.addEventListener('click', () => {
      // Clear the cache for the current article
      chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
        const activeTab = tabs[0];
        chrome.tabs.sendMessage(activeTab.id, {action: 'extractArticleInfo'}, function(articleInfo) {
          if (articleInfo) {
            const cacheKey = articleInfo.url || articleInfo.title;
            
            // Send message to clear specific cache entry
            chrome.runtime.sendMessage({
              action: 'clearCacheEntry',
              cacheKey: cacheKey
            }, () => {
              // Reload the popup to get fresh data
              window.location.reload();
            });
          }
        });
      });
    });
    
    container.appendChild(refreshButton);
  }
  
  // Add refresh button
  addRefreshButton();
}); 