document.addEventListener('DOMContentLoaded', async () => {
  console.log('Popup loaded');
  
  const statusDiv = document.getElementById('status');
  const loader = document.querySelector('.loader');
  const endpointInput = document.getElementById('endpoint');
  const apiKeyInput = document.getElementById('apiKey');
  const summarizeButton = document.getElementById('summarize');
  const summaryDiv = document.getElementById('summary');

  function showStatus(message, type) {
    statusDiv.textContent = message;
    statusDiv.className = type;
    statusDiv.style.display = 'block';
  }

  function hideStatus() {
    statusDiv.style.display = 'none';
  }

  function showLoader() {
    loader.style.display = 'block';
  }

  function hideLoader() {
    loader.style.display = 'none';
  }

  // Load saved settings
  try {
    const result = await chrome.storage.local.get(['endpoint', 'apiKey']);
    console.log('Loaded settings:', {
      endpoint: result.endpoint ? '[SET]' : '[NOT SET]',
      apiKey: result.apiKey ? '[SET]' : '[NOT SET]'
    });
    endpointInput.value = result.endpoint || '';
    apiKeyInput.value = result.apiKey || '';
  } catch (error) {
    console.error('Error loading settings:', error);
  }

  // Save settings when changed
  async function saveSettings() {
    const endpoint = endpointInput.value;
    const apiKey = apiKeyInput.value;
    
    try {
      await chrome.storage.local.set({ endpoint, apiKey });
      console.log('Settings saved');
    } catch (error) {
      console.error('Error saving settings:', error);
      showStatus('Error saving settings', 'error');
    }
  }

  // Add input event listeners
  endpointInput.addEventListener('input', saveSettings);
  apiKeyInput.addEventListener('input', saveSettings);

  /**
   * Fetches the YouTube transcript from the current tab by injecting a script
   * that opens the transcript panel and scrapes the text from the DOM.
   */
  async function getTranscript(tab) {
    console.log('Starting transcript fetch for tab:', tab.id);

    // First check if we're on a YouTube video page
    const [{ result: url }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => document.location.href
    });

    if (!url.includes('youtube.com/watch')) {
      throw new Error('Please navigate to a YouTube video page');
    }

    // Try to get transcript using the new YouTube UI
    const [{ result: transcriptResult }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        /**
         * Returns a Promise that attempts to open the “Meer”/“More actions” menu,
         * click the “Transcript tonen”/“Show transcript” button, and scrape text.
         */
        return new Promise((resolve, reject) => {
          console.log('Starting transcript extraction...');

          // Helper function to get the transcript text if it's already visible
          function getTranscriptText() {
			  const transcriptContainer = document.querySelector('ytd-transcript-segment-list-renderer');
			  if (!transcriptContainer) {
				return null;
			  }

			  // Each line is a <ytd-transcript-segment-renderer> element
			  const segments = Array.from(
				transcriptContainer.querySelectorAll('ytd-transcript-segment-renderer')
			  );
			  if (!segments.length) {
				return null;
			  }

			  // Grab the video title
			  const videoTitle = document.querySelector('h1.ytd-video-primary-info-renderer')
				?.textContent?.trim() || '';

			  // Build an array of "[time] text" lines
			  const transcriptText = segments.map(segment => {
				// The time appears in <span class="segment-timestamp">
				const time = segment.querySelector('.segment-timestamp')?.textContent.trim();

				// The spoken text appears in <span class="segment-text">
				const text = segment.querySelector('.segment-text')?.textContent.trim();

				// If you want timecodes, include them; otherwise, just return `text`.
				if (time && text) {
				  return `[${time}] ${text}`;
				}
				return text; // Or return null if you need both time and text
			  }).filter(Boolean);

			  if (transcriptText.length > 0) {
				// Join lines with newlines
				return `Title: ${videoTitle}\n\nTranscript:\n${transcriptText.join('\n')}`;
			  }

			  return null;
			}

          /**
           * Opens the “Meer”/“More actions” menu, then clicks the “Transcript tonen”/“Show transcript” button.
           * Returns a Promise that resolves once the transcript button has been clicked.
           */
          function openTranscriptPanel() {
            return new Promise((resolvePanel, rejectPanel) => {
              // Try either the Dutch or English aria-label
              const moreButton = document.querySelector(
                'button[aria-label="Meer"], button[aria-label="More actions"]'
              );
              if (!moreButton) {
                return rejectPanel(new Error("Could not find 'Meer' / 'More actions' button"));
              }

              // Click the 'Meer' / 'More actions' button
              moreButton.click();

              // Poll for the transcript button
              let attempts = 0;
              const checkInterval = setInterval(() => {
                attempts++;
                console.log('Checking for transcript button, attempt:', attempts);

                // Look for Dutch or English aria-labels
                const transcriptButton = document.querySelector(
                  'button[aria-label="Transcript tonen"], ' +
                  'button[aria-label="Show transcript"], ' +
                  'button[aria-label="Open transcript"]'
                );

                if (transcriptButton) {
                  clearInterval(checkInterval);
                  transcriptButton.click();
                  resolvePanel(true);
                }

                if (attempts >= 10) {
                  clearInterval(checkInterval);
                  rejectPanel(new Error('Transcript button did not appear'));
                }
              }, 500);
            });
          }

          // 1) If the transcript is already visible, return immediately
          let text = getTranscriptText();
          if (text) {
            console.log('Found existing transcript');
            return resolve(text);
          }

          // 2) Otherwise, open the transcript panel
          openTranscriptPanel()
            .then(() => {
              // Now poll for the actual transcript text
              let attempts = 0;
              const checkInterval = setInterval(() => {
                attempts++;
                console.log('Checking for transcript text, attempt:', attempts);

                text = getTranscriptText();
                if (text) {
                  clearInterval(checkInterval);
                  console.log('Successfully found transcript with length:', text.length);
                  return resolve(text);
                }

                // Check for error messages
                const errorElement = document.querySelector('.ytd-transcript-error-message');
                if (errorElement) {
                  clearInterval(checkInterval);
                  return reject(new Error('YouTube says: ' + errorElement.textContent));
                }

                if (attempts >= 10) {
                  clearInterval(checkInterval);
                  return reject(new Error('Could not find transcript after multiple attempts'));
                }
              }, 1000);
            })
            .catch(error => {
              reject(error);
            });
        });
      }
    });

    if (!transcriptResult) {
      throw new Error('Could not extract transcript');
    }

    console.log('Transcript extracted successfully');
    return transcriptResult;
  }

  // Handle summarize button click
  summarizeButton.addEventListener('click', async () => {
    console.log('Summarize button clicked');
    
    const endpoint = endpointInput.value;
    const apiKey = apiKeyInput.value;
    
    if (!endpoint || !apiKey) {
      showStatus('Please configure API settings first.', 'error');
      return;
    }

    summarizeButton.disabled = true;
    hideStatus();
    summaryDiv.textContent = '';
    showLoader();

    try {
      // Get the active tab
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab) {
        throw new Error('No active tab found');
      }

      showStatus('Fetching transcript...', 'info');
      console.log('Starting transcript fetch...');
      
      const transcript = await getTranscript(tab);
      
      if (!transcript) {
        throw new Error('Could not fetch transcript');
      }

      console.log('Transcript length:', transcript.length);
      console.log('First 100 characters:', transcript.substring(0, 100));

      showStatus('Generating summary...', 'info');
      console.log('Sending to API...');
      
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: "gpt-3.5-turbo",
          messages: [
            { 
              role: 'system', 
              content: 'You are a helpful assistant that creates concise video summaries. Provide a clear, well-structured summary of the video based on its transcript.'
            },
            { 
              role: 'user', 
              content: `Please provide a concise summary of this video. Focus on the main points and key takeaways.\n\n${transcript}`
            }
          ],
          max_tokens: 500,
          temperature: 0.7,
          stream: false
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('API Error:', {
          status: response.status,
          statusText: response.statusText,
          error: errorText
        });
        throw new Error(`API request failed: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      hideStatus();
      summaryDiv.textContent = data.choices?.[0]?.message?.content || '[No summary returned]';
      
    } catch (error) {
      console.error('Error:', error);
      showStatus(`Error: ${error.message}`, 'error');
    } finally {
      summarizeButton.disabled = false;
      hideLoader();
    }
  });

  // Log that initialization is complete
  console.log('Popup initialization complete');
});
