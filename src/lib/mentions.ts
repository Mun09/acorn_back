/**
 * Mention parsing utilities
 * Extracts @handle mentions from text content
 */

export interface Mention {
  raw: string; // Full match including @
  handle: string; // Handle without @
  startIndex: number;
  endIndex: number;
}

/**
 * Extract all @handle mentions from text
 * Supports handles with letters, numbers, underscores, and hyphens
 * Handle must be 3-30 characters long
 */
export function extractMentionsFromText(text: string): Mention[] {
  // Regex for @handle pattern
  // Matches: @username, @user_name, @user-name, @user123
  // Requires: 3-30 characters, starts with letter/number
  const mentionRegex = /@([a-zA-Z0-9][a-zA-Z0-9_-]{2,29})\b/g;

  const mentions: Mention[] = [];
  let match;

  while ((match = mentionRegex.exec(text)) !== null) {
    if (match[1]) {
      mentions.push({
        raw: match[0], // @username
        handle: match[1], // username
        startIndex: match.index,
        endIndex: match.index + match[0].length,
      });
    }
  }

  return mentions;
}

/**
 * Get unique handles from mentions (removes duplicates)
 */
export function getUniqueHandles(mentions: Mention[]): string[] {
  const uniqueHandles = new Set(mentions.map(m => m.handle.toLowerCase()));
  return Array.from(uniqueHandles);
}

/**
 * Replace mentions in text with formatted links
 * Useful for rendering mentions in UI
 */
export function formatMentionsInText(
  text: string,
  formatter: (handle: string) => string = handle =>
    `<a href="/user/${handle}">@${handle}</a>`
): string {
  const mentions = extractMentionsFromText(text);

  // Process mentions in reverse order to maintain indices
  let formattedText = text;
  for (let i = mentions.length - 1; i >= 0; i--) {
    const mention = mentions[i]!;
    const replacement = formatter(mention.handle);
    formattedText =
      formattedText.slice(0, mention.startIndex) +
      replacement +
      formattedText.slice(mention.endIndex);
  }

  return formattedText;
}

/**
 * Validate if a handle format is valid
 */
export function isValidHandle(handle: string): boolean {
  const handleRegex = /^[a-zA-Z0-9][a-zA-Z0-9_-]{2,29}$/;
  return handleRegex.test(handle);
}

/**
 * Parse text and return both content and extracted mentions
 */
export function parseTextWithMentions(text: string): {
  text: string;
  mentions: Mention[];
  uniqueHandles: string[];
} {
  const mentions = extractMentionsFromText(text);
  const uniqueHandles = getUniqueHandles(mentions);

  return {
    text,
    mentions,
    uniqueHandles,
  };
}
