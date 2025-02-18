// Debug log when content script loads
console.log('YouTube Transcript Summarizer: Content script loaded!');

// Simple test function
function getYouTubeTranscript() {
  return new Promise((resolve, reject) => {
    console.log('Attempting to get transcript...');
    try {
      // Just return a test string for now
      resolve('Test transcript content');
    } catch (error) {
      console.error('Error in getYouTubeTranscript:', error);
      reject(error);
    }
  });
}

// Listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('Content script received message:', request);
  
  if (request.action === 'getTranscript') {
    // Send back a test response
    sendResponse({ success: true, transcript: 'Test transcript content' });
  }
  return true;
});