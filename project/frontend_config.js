const config = window.__DREAM_ADMIN_CONFIG__;
const branding = window.__DREAM_BRANDING__ || {};
if (!config || !config.apiUrl)
  throw new Error("Set the app API URL in /app-config.js");
export const API_URL = config.apiUrl;
export const API_BASE = `${API_URL}/admin/`;
export const API_HOST = new URL(API_URL).host;
export const API_SCHEME = new URL(API_URL).protocol.slice(0, -1);
export const API_VERSION = "admin";
export const COPILOT_URL = config.copilotUrl || "";
export const COPILOT_BASE = COPILOT_URL;
export const FEATURES = { coreOnly: config.coreOnly === true };
export const BRAND = {
  name: config.name || "Dreamy",
  companyName: branding.company_name || "Dreamy",
  icon: branding.icon_url || "",
  logo: branding.logo_light_url || branding.logo_url || new URL("./assets/brand-light.svg", import.meta.url).href,
  logoDark: branding.logo_dark_url || branding.logo_url || new URL("./assets/brand.svg", import.meta.url).href,
};
export default {
  API_URL,
  API_BASE,
  API_HOST,
  API_SCHEME,
  API_VERSION,
  COPILOT_URL,
  COPILOT_BASE,
  BRAND,
  FEATURES,
};
