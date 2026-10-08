window.__DREAM_BRANDING__ = {{ branding }};
for (const [key,value] of Object.entries({primary:window.__DREAM_BRANDING__.primary_color,secondary:window.__DREAM_BRANDING__.accent_color,accent:window.__DREAM_BRANDING__.accent_color})) document.documentElement.style.setProperty("--q-"+key,value);
if (window.__DREAM_BRANDING__.icon_url) { let icon=document.querySelector("link[rel=icon]"); if(!icon){icon=document.createElement("link");icon.rel="icon";document.head.appendChild(icon)} icon.href=window.__DREAM_BRANDING__.icon_url; icon.removeAttribute("type"); }
