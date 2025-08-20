/**
 * Preserves existing hyperlinks when a story is updated
 * @param originalStory The original story with hyperlinks
 * @param updatedStory The updated story that may have lost hyperlinks
 * @returns The updated story with original hyperlinks preserved
 */
export function preserveHyperlinks(originalStory: string, updatedStory: string): string {
  // Extract all hyperlinks from the original story
  const hyperlinkRegex = /<a\s+href="([^"]+)"[^>]*>([^<]+)<\/a>/g;
  const hyperlinks: Array<{ url: string; text: string; fullMatch: string }> = [];
  
  let match;
  while ((match = hyperlinkRegex.exec(originalStory)) !== null) {
    hyperlinks.push({
      url: match[1],
      text: match[2],
      fullMatch: match[0]
    });
  }
  
  // If no hyperlinks to preserve, return updated story as-is
  if (hyperlinks.length === 0) {
    return updatedStory;
  }
  
  let result = updatedStory;
  
  // Try to restore hyperlinks by finding the text and replacing with the original hyperlink
  for (const link of hyperlinks) {
    // Escape special regex characters in the text
    const escapedText = link.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const textRegex = new RegExp(`\\b${escapedText}\\b`, 'gi');
    
    // Only replace if the text exists and isn't already a hyperlink
    if (textRegex.test(result) && !result.includes(`href="${link.url}"`)) {
      result = result.replace(textRegex, link.fullMatch);
    }
  }
  
  return result;
}

/**
 * Removes an existing section from a story
 * @param story The story to modify
 * @param sectionName The name of the section to remove
 * @returns The story with the section removed
 */
export function removeExistingSection(story: string, sectionName: string): string {
  // Simple implementation - remove lines containing the section name
  const lines = story.split('\n');
  const filteredLines = lines.filter(line => 
    !line.toLowerCase().includes(sectionName.toLowerCase())
  );
  return filteredLines.join('\n');
} 