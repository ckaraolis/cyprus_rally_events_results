/** Inline script to apply stored theme before paint (avoids flash). */
export function themeInlineScript(): string {
  return `(function(){try{var t=localStorage.getItem('ewrc-theme');if(t==='light')document.documentElement.classList.add('light');}catch(e){}})();`;
}
