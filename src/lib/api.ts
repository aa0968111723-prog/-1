export async function apiFetch(url: string, options?: RequestInit) {
  const startTime = Date.now();
  let requestPayload;
  let method = options?.method || 'GET';
  
  if (options?.body && typeof options.body === 'string') {
    try {
      requestPayload = JSON.parse(options.body);
    } catch {
      requestPayload = options.body;
    }
  }

  let provider = 'Local Backend';
  let estimatedCost = 0;
  let costDetails = '';

  if (url.includes('gemini')) {
    provider = 'Google Gemini';
  } else if (url.includes('elevenlabs')) {
    provider = 'ElevenLabs';
  } else if (url.includes('suno')) {
    provider = 'Suno API';
  } else if (url.includes('fal')) {
    provider = 'Fal AI';
  } else if (url.includes('pinecone')) {
    provider = 'Pinecone';
  }

  try {
    const response = await fetch(url, options);
    const endTime = Date.now();
    const durationMs = endTime - startTime;
    
    // Clone response to read body
    const clone = response.clone();
    let responsePayload;
    
    const contentType = response.headers.get("content-type");
    let contentSize = 0;

    if (contentType && contentType.includes("application/json")) {
       try { 
         responsePayload = await clone.json(); 
         contentSize = JSON.stringify(responsePayload).length;
       } catch(e) {}
    } else if (contentType && contentType.includes("audio")) {
       const blob = await clone.blob();
       contentSize = blob.size;
       responsePayload = { audio_blob: `Audio Received (${(blob.size / 1024).toFixed(2)} KB)` };
    } else {
       try { 
         responsePayload = await clone.text(); 
         contentSize = responsePayload.length;
       } catch(e) {}
    }

    // Estimate realistic costs for operations
    if (provider === 'Google Gemini') {
       const charCount = (requestPayload?.prompt?.length || 0) + contentSize;
       // Roughly 3 tokens per 4 chars, $0.075 input / $0.30 output per 1M tokens
       // Just a ballpark estimate mapping character length to pennies
       estimatedCost = (charCount / 4) * 3 * (0.0000002);
       costDetails = `Est Tokens: ${Math.floor((charCount/4)*3)}`;
    } else if (provider === 'ElevenLabs') {
       const textLen = requestPayload?.text?.length || 0;
       estimatedCost = textLen * 0.0003; // ~ $0.30 per 1k characters
       costDetails = `Characters: ${textLen}`;
    } else if (provider === 'Fal AI') {
       estimatedCost = 0.003; // ~ $0.003 per schnell image
       costDetails = `Model: flux/schnell`;
    } else if (provider === 'Suno API') {
       estimatedCost = 0.012; // ~ roughly per execution wrapper
       costDetails = `Execution Fee`;
    } else if (provider === 'Pinecone') {
       estimatedCost = 0.0;
       costDetails = `Free Tier Read`;
    }

    const eventDetail = {
      id: Math.random().toString(36).substring(2, 11),
      provider,
      endpoint: url,
      method,
      status: response.status,
      timestamp: new Date(),
      durationMs,
      requestPayload,
      responsePayload,
      costUSD: estimatedCost,
      costDetails,
      amount: estimatedCost, // Map as revenue/spend for the chart
      errorMessage: response.ok ? undefined : (responsePayload?.error || responsePayload?.message || `HTTP Error ${response.status}`)
    };

    window.dispatchEvent(new CustomEvent('api-log-event', { detail: eventDetail }));

    return response;
  } catch (err: any) {
    const durationMs = Date.now() - startTime;
    
    window.dispatchEvent(new CustomEvent('api-log-event', {
      detail: {
        id: Math.random().toString(36).substring(2, 11),
        provider,
        endpoint: url,
        method,
        status: 0,
        timestamp: new Date(),
        durationMs,
        requestPayload,
        costUSD: 0,
        amount: 0,
        errorMessage: err.message
      }
    }));
    throw err;
  }
}
