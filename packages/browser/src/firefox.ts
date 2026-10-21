/**
 * Firefox's built-in consent for data sent off the device (required for new add-ons
 * since Nov 2025). Margin declares `websiteContent` as optional and asks for it only
 * when the user picks Gemini; local models send nothing anywhere. Other browsers rely
 * on the consent checkbox in Margin's options.
 */
const isFirefox = typeof navigator !== 'undefined' && navigator.userAgent.includes('Firefox');
const DATA = { data_collection: ['websiteContent'] } as unknown as chrome.permissions.Permissions;

/** Must run in a user gesture (it may show Firefox's prompt). */
export async function requestDataConsent(): Promise<boolean> {
  if (!isFirefox) return true;
  try {
    return await chrome.permissions.request(DATA);
  } catch {
    return true; // a Firefox without data-collection permissions: the options checkbox is the consent
  }
}

export async function hasDataConsent(): Promise<boolean> {
  if (!isFirefox) return true;
  try {
    return await chrome.permissions.contains(DATA);
  } catch {
    return true;
  }
}
