window.BOOK_OF_MEY_SUPABASE = {
  url: "https://dafnshawabjbrxmjletk.supabase.co",
  anonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRhZm5zaGF3YWJqYnJ4bWpsZXRrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgwOTM2MDcsImV4cCI6MjA5MzY2OTYwN30.BHphThXsFLtg3bwZgYy82yXiOPJTbCIDZZ3I2HUAVjM",
};

window.addEventListener("DOMContentLoaded", () => {
  [
    "asset/js/audio-anchor-hotfix.js?v=20260813-4",
    "asset/js/editor-audio-anchor-hotfix.js?v=20260813",
  ].forEach((src) => {
    const hotfix = document.createElement("script");
    hotfix.src = src;
    document.body.appendChild(hotfix);
  });
}, { once: true });
