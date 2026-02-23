// Metadata utility module for reading and embedding ID3 tags in MP3/WAV files

/**
 * Extract metadata from track API response
 * @param {Object} trackData - Track data from Suno API
 * @returns {Object} Normalized metadata object
 */
function extractMetadataFromTrack(trackData) {
  const metadata = {
    title: trackData.title || null,
    artist: trackData.metadata?.artist || trackData.artist || trackData.display_name || "Suno AI" || null,
    album: trackData.metadata?.album || trackData.album || null,
    genre: trackData.metadata?.genre || trackData.genre || null,
    year: trackData.created_at ? new Date(trackData.created_at).getFullYear() : null,
    lyrics: trackData.metadata?.infill_lyrics || trackData.lyrics || trackData.metadata?.lyrics || trackData.lyric || trackData.metadata?.prompt || null,
    bpm: trackData.bpm || trackData.metadata?.bpm || trackData.metadata?.tempo || trackData.tempo || null,
    key: trackData.key || trackData.metadata?.key || trackData.metadata?.musical_key || trackData.musical_key || null,
    // Use tags/styles for the comment/prompt field as requested
    comment: trackData.metadata?.tags || trackData.metadata?.gpt_description_prompt || trackData.metadata?.prompt || trackData.prompt || trackData.gpt_description_prompt || null,
    coverArt: trackData.image_url || trackData.image_large_url || trackData.cover_url || trackData.metadata?.image_url || trackData.metadata?.cover_url || trackData.image || trackData.cover_image || null,
    trackNumber: null,
    albumArtist: "Suno AI",
    // Store full data for sidecar file
    fullData: trackData
  };

  // Remove null values for cleaner output
  Object.keys(metadata).forEach(key => {
    if (metadata[key] === null) {
      delete metadata[key];
    }
  });

  return metadata;
}

/**
 * Read existing metadata from audio file blob
 * Uses jsmediatags library (must be loaded)
 * @param {Blob} blob - Audio file blob
 * @returns {Promise<Object>} Existing metadata tags
 */
async function readMetadata(blob) {
  return new Promise((resolve, reject) => {
    // Check if jsmediatags is available
    if (typeof jsmediatags === 'undefined') {
      console.warn('jsmediatags not loaded, skipping metadata read');
      resolve({});
      return;
    }

    jsmediatags.read(blob, {
      onSuccess: function(tag) {
        const tags = tag.tags || {};
        const metadata = {
          title: tags.title || null,
          artist: tags.artist || null,
          album: tags.album || null,
          genre: tags.genre || null,
          year: tags.year || null,
          lyrics: tags.unsynchronisedLyrics || tags.lyrics || tags['USLT'] || null,
          bpm: tags.bpm || tags['TBPM'] || null,
          key: tags.key || tags['TKEY'] || null,
          comment: tags.comment || tags.comment?.text || null,
          trackNumber: tags.track || tags['TRCK'] || null,
        };
        resolve(metadata);
      },
      onError: function(error) {
        console.warn('Error reading metadata:', error);
        resolve({});
      }
    });
  });
}

/**
 * Embed metadata into WAV blob using RIFF INFO chunks
 * @param {Blob} audioBlob - Original WAV file blob
 * @param {Object} metadata - Metadata to embed
 * @returns {Promise<Blob>} New blob with embedded metadata
 */
async function embedWavMetadata(audioBlob, metadata) {
  try {
    const arrayBuffer = await audioBlob.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);

    // Check if it's a valid WAV file (starts with "RIFF")
    if (uint8Array[0] !== 0x52 || uint8Array[1] !== 0x49 || uint8Array[2] !== 0x46 || uint8Array[3] !== 0x46) {
      console.warn('Not a valid WAV file, skipping metadata embedding');
      return audioBlob;
    }

    // WAV files can also use ID3v2 tags (placed before the RIFF header)
    // For simplicity, we'll append ID3v2 tag at the end of the file
    // This is a common approach and most players support it
    
    // Create ID3v2 tag (same as MP3)
    const id3Header = new Uint8Array(10);
    id3Header[0] = 0x49; // 'I'
    id3Header[1] = 0x44; // 'D'
    id3Header[2] = 0x33; // '3'
    id3Header[3] = 0x03; // Version 2.3.0
    id3Header[4] = 0x00; // Revision
    id3Header[5] = 0x00; // Flags

    const frames = [];
    
    if (metadata.title) frames.push(createTextFrame('TIT2', metadata.title));
    if (metadata.artist) frames.push(createTextFrame('TPE1', metadata.artist));
    if (metadata.album) frames.push(createTextFrame('TALB', metadata.album));
    if (metadata.year) frames.push(createTextFrame('TDRC', String(metadata.year)));
    if (metadata.genre) frames.push(createTextFrame('TCON', metadata.genre));
    if (metadata.bpm) frames.push(createTextFrame('TBPM', String(metadata.bpm)));
    if (metadata.key) frames.push(createTextFrame('TKEY', metadata.key));
    if (metadata.comment) frames.push(createCommentFrame(metadata.comment));
    if (metadata.lyrics) frames.push(createLyricsFrame(metadata.lyrics));
    
    if (metadata.coverArt) {
      try {
        console.log('Fetching cover art from:', metadata.coverArt);
        const coverBlob = await fetchCoverArt(metadata.coverArt);
        if (coverBlob) {
          console.log('Cover art fetched successfully, size:', coverBlob.size, 'bytes');
          const coverFrame = await createCoverArtFrame(coverBlob);
          frames.push(coverFrame);
          console.log('Cover art frame created and added to metadata');
        } else {
          console.warn('Cover art blob is null or empty');
        }
      } catch (error) {
        console.error('Failed to fetch or create cover art frame:', error);
      }
    } else {
      console.warn('No cover art URL in metadata');
    }
    
    let tagSize = 0;
    frames.forEach(frame => tagSize += frame.length);
    
    const sizeBytes = encodeSynchsafe(tagSize);
    id3Header[6] = sizeBytes[0];
    id3Header[7] = sizeBytes[1];
    id3Header[8] = sizeBytes[2];
    id3Header[9] = sizeBytes[3];
    
    const tagData = new Uint8Array(10 + tagSize);
    tagData.set(id3Header, 0);
    let offset = 10;
    frames.forEach(frame => {
      tagData.set(frame, offset);
      offset += frame.length;
    });
    
    // Append ID3 tag to WAV file
    const newArrayBuffer = new ArrayBuffer(arrayBuffer.byteLength + tagData.length);
    const newUint8Array = new Uint8Array(newArrayBuffer);
    newUint8Array.set(uint8Array, 0);
    newUint8Array.set(tagData, arrayBuffer.byteLength);
    
    return new Blob([newArrayBuffer], { type: audioBlob.type });
    
  } catch (error) {
    console.error('Error embedding WAV metadata:', error);
    return audioBlob;
  }
}

/**
 * Embed metadata into MP3 blob using ID3 tags
 * This is a simplified implementation that creates ID3v2.3 tags
 * @param {Blob} audioBlob - Original audio file blob
 * @param {Object} metadata - Metadata to embed
 * @returns {Promise<Blob>} New blob with embedded metadata
 */
async function embedMetadata(audioBlob, metadata) {
  // Check if it's a WAV file
  if (audioBlob.type === 'audio/wav' || audioBlob.type === 'audio/wave' || 
      (audioBlob.type === '' && audioBlob.size > 12)) {
    // Check first bytes for WAV signature
    const firstBytes = await audioBlob.slice(0, 12).arrayBuffer();
    const header = new Uint8Array(firstBytes);
    if (header[0] === 0x52 && header[1] === 0x49 && header[2] === 0x46 && header[3] === 0x46) {
      return embedWavMetadata(audioBlob, metadata);
    }
  }
  
  // Default to MP3 handling
  try {
    // Convert blob to ArrayBuffer for manipulation
    const arrayBuffer = await audioBlob.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);

    // Find the ID3 tag position (usually at the start)
    // ID3v2 tags start with "ID3" (0x49 0x44 0x33)
    let id3Start = -1;
    for (let i = 0; i < Math.min(10, uint8Array.length); i++) {
      if (uint8Array[i] === 0x49 && uint8Array[i + 1] === 0x44 && uint8Array[i + 2] === 0x33) {
        id3Start = i;
        break;
      }
    }

    // If no ID3 tag found, we'll prepend one
    // For now, we'll use a simpler approach: fetch the file with metadata preserved
    // and if that doesn't work, we'll create a basic ID3 tag

    // Create ID3v2.3 tag header (10 bytes)
    const id3Header = new Uint8Array(10);
    id3Header[0] = 0x49; // 'I'
    id3Header[1] = 0x44; // 'D'
    id3Header[2] = 0x33; // '3'
    id3Header[3] = 0x03; // Version 2.3.0
    id3Header[4] = 0x00; // Revision
    id3Header[5] = 0x00; // Flags (no unsynchronisation, no extended header, no experimental indicator)
    
    // Calculate tag size (we'll build frames first)
    const frames = [];
    
    // Title frame (TIT2)
    if (metadata.title) {
      frames.push(createTextFrame('TIT2', metadata.title));
    }
    
    // Artist frame (TPE1)
    if (metadata.artist) {
      frames.push(createTextFrame('TPE1', metadata.artist));
    }

    // Cover art frame (APIC) - Place early for Windows compatibility
    if (metadata.coverArt) {
      try {
        console.log('Fetching cover art from:', metadata.coverArt);
        const coverBlob = await fetchCoverArt(metadata.coverArt);
        if (coverBlob) {
          console.log('Cover art fetched successfully, size:', coverBlob.size, 'bytes');
          const coverFrame = await createCoverArtFrame(coverBlob);
          frames.push(coverFrame);
          console.log('Cover art frame created and added to metadata');
        } else {
          console.warn('Cover art blob is null or empty');
        }
      } catch (error) {
        console.error('Failed to fetch or create cover art frame:', error);
      }
    } else {
      console.warn('No cover art URL in metadata');
    }
    
    // Album frame (TALB)
    if (metadata.album) {
      frames.push(createTextFrame('TALB', metadata.album));
    }
    
    // Year frame (TDRC)
    if (metadata.year) {
      frames.push(createTextFrame('TDRC', String(metadata.year)));
    }
    
    // Genre frame (TCON)
    if (metadata.genre) {
      frames.push(createTextFrame('TCON', metadata.genre));
    }
    
    // BPM frame (TBPM)
    if (metadata.bpm) {
      frames.push(createTextFrame('TBPM', String(metadata.bpm)));
    }
    
    // Key frame (TKEY) - custom frame
    if (metadata.key) {
      frames.push(createTextFrame('TKEY', metadata.key));
    }
    
    // Comment frame (COMM)
    if (metadata.comment) {
      console.log("Adding COMM frame (Prompt), length:", metadata.comment.length);
      frames.push(createCommentFrame(metadata.comment));
    } else {
      console.log("No comment/prompt to add to COMM frame");
    }
    
    // Lyrics frame (USLT)
    if (metadata.lyrics) {
      console.log("Adding USLT frame (Lyrics), length:", metadata.lyrics.length);
      frames.push(createLyricsFrame(metadata.lyrics));
    } else {
      console.log("No lyrics to add to USLT frame");
    }
    
    // Cover art frame (APIC) moved up for compatibility
    
    // Calculate total tag size
    let tagSize = 0;
    frames.forEach(frame => tagSize += frame.length);
    
    // Set tag size in header (synchsafe integer)
    const sizeBytes = encodeSynchsafe(tagSize);
    id3Header[6] = sizeBytes[0];
    id3Header[7] = sizeBytes[1];
    id3Header[8] = sizeBytes[2];
    id3Header[9] = sizeBytes[3];
    
    // Combine header + frames
    const tagData = new Uint8Array(10 + tagSize);
    tagData.set(id3Header, 0);
    let offset = 10;
    frames.forEach(frame => {
      tagData.set(frame, offset);
      offset += frame.length;
    });
    
    // If ID3 tag already exists, replace it; otherwise prepend
    let audioDataStart = 0;
    if (id3Start >= 0 && id3Start + 10 <= uint8Array.length) {
      try {
        // Read existing ID3 tag size
        const existingSize = decodeSynchsafe([
          uint8Array[id3Start + 6],
          uint8Array[id3Start + 7],
          uint8Array[id3Start + 8],
          uint8Array[id3Start + 9]
        ]);
        audioDataStart = id3Start + 10 + existingSize;
        // Ensure we don't go beyond array bounds
        if (audioDataStart > arrayBuffer.byteLength) {
          audioDataStart = id3Start + 10; // Fallback to just after header
        }
      } catch (error) {
        console.warn('Error reading existing ID3 tag, prepending new tag:', error);
        audioDataStart = 0;
      }
    }
    
    // Ensure we have valid bounds
    const remainingAudioSize = Math.max(0, arrayBuffer.byteLength - audioDataStart);
    
    // Create new blob with embedded metadata
    const newArrayBuffer = new ArrayBuffer(tagData.length + remainingAudioSize);
    const newUint8Array = new Uint8Array(newArrayBuffer);
    newUint8Array.set(tagData, 0);
    if (remainingAudioSize > 0) {
      newUint8Array.set(uint8Array.slice(audioDataStart, audioDataStart + remainingAudioSize), tagData.length);
    }
    
    return new Blob([newArrayBuffer], { type: audioBlob.type });
    
  } catch (error) {
    console.error('Error embedding metadata:', error);
    // Return original blob if embedding fails
    return audioBlob;
  }
}

/**
 * Create a text frame for ID3v2.3
 */
function createTextFrame(frameId, text) {
  const textBytes = new TextEncoder().encode(text);
  const frame = new Uint8Array(10 + textBytes.length + 1); // +1 for encoding byte
  
  // Frame ID (4 bytes)
  const encoder = new TextEncoder();
  const frameIdBytes = encoder.encode(frameId);
  frame.set(frameIdBytes, 0);
  
  // Frame size (4 bytes, not synchsafe)
  const size = textBytes.length + 1; // +1 for encoding byte
  frame[4] = (size >> 24) & 0xFF;
  frame[5] = (size >> 16) & 0xFF;
  frame[6] = (size >> 8) & 0xFF;
  frame[7] = size & 0xFF;
  
  // Flags (2 bytes) - no compression, no encryption, no grouping
  frame[8] = 0x00;
  frame[9] = 0x00;
  
  // Encoding (1 byte) - UTF-8
  frame[10] = 0x03;
  
  // Text data
  frame.set(textBytes, 11);
  
  return frame;
}

/**
 * Create a comment frame (COMM)
 */
function createCommentFrame(comment) {
  const textBytes = new TextEncoder().encode(comment);
  const frame = new Uint8Array(10 + 5 + textBytes.length); // +5 for language + encoding + description
  
  // Frame ID
  const encoder = new TextEncoder();
  frame.set(encoder.encode('COMM'), 0);
  
  // Frame size
  const size = 5 + textBytes.length;
  frame[4] = (size >> 24) & 0xFF;
  frame[5] = (size >> 16) & 0xFF;
  frame[6] = (size >> 8) & 0xFF;
  frame[7] = size & 0xFF;
  
  // Flags
  frame[8] = 0x00;
  frame[9] = 0x00;
  
  // Encoding (UTF-8)
  frame[10] = 0x03;
  
  // Language (3 bytes) - 'eng'
  frame[11] = 0x65; // 'e'
  frame[12] = 0x6E; // 'n'
  frame[13] = 0x67; // 'g'
  
  // Short content description (empty, 1 byte)
  frame[14] = 0x00;
  
  // Comment text
  frame.set(textBytes, 15);
  
  return frame;
}

/**
 * Create a lyrics frame (USLT)
 */
function createLyricsFrame(lyrics) {
  const textBytes = new TextEncoder().encode(lyrics);
  const frame = new Uint8Array(10 + 5 + textBytes.length);
  
  // Frame ID
  const encoder = new TextEncoder();
  frame.set(encoder.encode('USLT'), 0);
  
  // Frame size
  const size = 5 + textBytes.length;
  frame[4] = (size >> 24) & 0xFF;
  frame[5] = (size >> 16) & 0xFF;
  frame[6] = (size >> 8) & 0xFF;
  frame[7] = size & 0xFF;
  
  // Flags
  frame[8] = 0x00;
  frame[9] = 0x00;
  
  // Encoding (UTF-8)
  frame[10] = 0x03;
  
  // Language (3 bytes) - 'eng'
  frame[11] = 0x65;
  frame[12] = 0x6E;
  frame[13] = 0x67;
  
  // Content descriptor (empty, 1 byte)
  frame[14] = 0x00;
  
  // Lyrics text
  frame.set(textBytes, 15);
  
  return frame;
}

/**
 * Create a cover art frame (APIC)
 */
async function createCoverArtFrame(coverBlob) {
  const coverArrayBuffer = await coverBlob.arrayBuffer();
  const coverBytes = new Uint8Array(coverArrayBuffer);
  
  // Determine MIME type
  let mimeType = 'image/jpeg';
  if (coverBlob.type) {
    mimeType = coverBlob.type;
  }
  const mimeBytes = new TextEncoder().encode(mimeType);
  
  // Determine image type byte
  let imageType = 0x03; // Cover (front)
  
  // Description text (default to "Cover" to match Suno's format)
  const descriptionText = 'Cover';
  // Use simple ASCII encoding for description (compatible with ISO-8859-1)
  const descriptionBytes = new Uint8Array(descriptionText.length);
  for (let i = 0; i < descriptionText.length; i++) {
    descriptionBytes[i] = descriptionText.charCodeAt(i);
  }
  
  // Calculate frame size: encoding(1) + mimeType(null-terminated) + pictureType(1) + description(null-terminated) + pictureData
  const frameDataSize = 1 + mimeBytes.length + 1 + 1 + descriptionBytes.length + 1 + coverBytes.length; // encoding + mime + null + type + desc + null + data
  const frame = new Uint8Array(10 + frameDataSize);
  
  // Frame ID
  const encoder = new TextEncoder();
  frame.set(encoder.encode('APIC'), 0);
  
  // Frame size (not synchsafe for frame size)
  frame[4] = (frameDataSize >> 24) & 0xFF;
  frame[5] = (frameDataSize >> 16) & 0xFF;
  frame[6] = (frameDataSize >> 8) & 0xFF;
  frame[7] = frameDataSize & 0xFF;
  
  // Flags
  frame[8] = 0x00;
  frame[9] = 0x00;
  
  let offset = 10;
  
  // Encoding (0x00 = ISO-8859-1) - Critical for Windows Media Player compatibility
  frame[offset++] = 0x00;
  
  // MIME type (null-terminated)
  frame.set(mimeBytes, offset);
  offset += mimeBytes.length;
  frame[offset++] = 0x00; // Null terminator
  
  // Picture type
  frame[offset++] = imageType;
  
  // Description (null-terminated string)
  frame.set(descriptionBytes, offset);
  offset += descriptionBytes.length;
  frame[offset++] = 0x00; // Null terminator
  
  // Picture data
  frame.set(coverBytes, offset);
  
  return frame;
}

/**
 * Fetch cover art from URL
 */
async function fetchCoverArt(url) {
  try {
    console.log('Fetching cover art from URL:', url);
    const response = await fetch(url, {
      method: 'GET',
      mode: 'cors',
      credentials: 'omit',
    });
    if (!response.ok) {
      console.error('Failed to fetch cover art:', response.status, response.statusText);
      return null;
    }
    const blob = await response.blob();
    console.log('Cover art blob created, size:', blob.size, 'bytes, type:', blob.type);
    return blob;
  } catch (error) {
    console.error('Error fetching cover art:', error);
    return null;
  }
}

/**
 * Encode integer as synchsafe (for ID3 tag size)
 */
function encodeSynchsafe(value) {
  return [
    ((value >> 21) & 0x7F),
    ((value >> 14) & 0x7F),
    ((value >> 7) & 0x7F),
    (value & 0x7F)
  ];
}

/**
 * Decode synchsafe integer
 */
function decodeSynchsafe(bytes) {
  return (bytes[0] << 21) | (bytes[1] << 14) | (bytes[2] << 7) | bytes[3];
}

// Export functions for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    extractMetadataFromTrack,
    readMetadata,
    embedMetadata,
    embedWavMetadata
  };
}

