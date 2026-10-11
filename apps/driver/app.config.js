const { URL } = require("node:url");

module.exports = ({ config }) => {
  if (process.env.EAS_BUILD_PROFILE === "production") {
    const rawApiUrl = process.env.EXPO_PUBLIC_API_URL?.trim();
    if (!rawApiUrl) {
      throw new Error("EXPO_PUBLIC_API_URL is required for a production FairMove build.");
    }

    let apiUrl;
    try {
      apiUrl = new URL(rawApiUrl);
    } catch {
      throw new Error("EXPO_PUBLIC_API_URL must be a valid absolute URL.");
    }

    if (apiUrl.protocol !== "https:" || !apiUrl.hostname) {
      throw new Error("EXPO_PUBLIC_API_URL must be an absolute HTTPS URL in production.");
    }
  }

  return config;
};
