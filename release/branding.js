window.__DREAM_BRANDING__ = {{ branding }};
for (const [key,value] of Object.entries({primary:window.__DREAM_BRANDING__.primary_color,secondary:window.__DREAM_BRANDING__.accent_color,accent:window.__DREAM_BRANDING__.accent_color})) document.documentElement.style.setProperty("--q-"+key,value);
// The workspace's square icon is the tab's icon. This script runs before the
// page's own icon link in <head>, and a browser uses the last icon it reads, so
// every icon link points at it now and again once the page is parsed. The links
// stay where they are, ids and all: the sign-in page's own script sets
// #brand-favicon, and a link it cannot find stopped that page with an error.
if (window.__DREAM_BRANDING__.icon_url) {
  const setIcon = () => {
    const links = document.querySelectorAll("link[rel~=icon]");
    links.forEach((link) => {
      link.removeAttribute("type");
      link.href = window.__DREAM_BRANDING__.icon_url;
    });
    if (links.length) return;
    const icon = document.createElement("link");
    icon.rel = "icon";
    icon.href = window.__DREAM_BRANDING__.icon_url;
    document.head.appendChild(icon);
  };
  setIcon();
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", setIcon);
}
