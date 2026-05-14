(function() {
    function applyTheme(s) {
        if (!s) return;

        // 1. Handle External Theme CSS
        const old = document.getElementById('kiyo-theme-link');
        if (old) old.remove();

        if (s.theme && s.theme !== 'default') {
            const link = document.createElement('link');
            link.id = 'kiyo-theme-link';
            link.rel = 'stylesheet';

            // Determine relative path to themes directory based on current page location
            const path = window.location.pathname;
            let themePrefix = '../themes/';
            if (path.includes('/pages/')) {
                themePrefix = '../../themes/';
            }

            link.href = `${themePrefix}${s.theme}.css`;
            document.head.appendChild(link);
        } else {
            // Default theme resets
            document.documentElement.style.setProperty('--arch-blue', '#00d2ff');
            document.documentElement.style.setProperty('--bg-dark', '#0a0b10');
        }

        // 2. Handle Design Tokens
        if (s.blurIntensity !== undefined) {
            document.documentElement.style.setProperty('--header-blur', s.blurIntensity + 'px');
        }

        if (s.tabStyle) {
            const r = s.tabStyle === 'square' ? '2px' : s.tabStyle === 'circle' ? '50%' : '16px';
            document.documentElement.style.setProperty('--tab-radius', r);
        }
    }

    // Initialize and listen for updates
    if (window.electronAPI) {
        window.electronAPI.getSettings().then(applyTheme);
        window.electronAPI.onThemeUpdated(applyTheme);
    }
})();
