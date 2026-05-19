const { ipcRenderer } = require('electron');

// Submit listener to capture credentials for the password manager
if (typeof window !== 'undefined') {
  window.addEventListener('DOMContentLoaded', () => {
    document.addEventListener('submit', (e) => {
      try {
        const form = e.target;
        if (!form || typeof form.querySelector !== 'function') return;
        const pwField = form.querySelector('input[type="password"]');
        const userField = pwField && (
          form.querySelector('input[type="email"]') ||
          form.querySelector('input[type="text"][autocomplete*="user"]') ||
          form.querySelector('input[name*="user"], input[name*="email"], input[id*="user"], input[id*="email"]')
        );
        if (pwField && pwField.value) {
          const username = userField ? userField.value : '';
          const password = pwField.value;
          ipcRenderer.send('pw-captured', window.location.hostname, username, password);
        }
      } catch (err) {
        // Silently ignore form parsing errors on untrusted web pages
      }
    });
  });
}
