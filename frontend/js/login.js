document.addEventListener('DOMContentLoaded', () => {
  if (Auth.isLoggedIn()) {
    window.location.href = 'dashboard.html';
    return;
  }

  // Explicitly offers the credential to the browser's password manager.
  // Needed because this is a fetch()-driven login (no real form POST/navigation),
  // which Chrome won't reliably pick up on its own without this API.
  async function offerToSaveCredential(email, password, name) {
    if (!window.PasswordCredential) return; // not supported (e.g. Firefox, Safari) — skip silently
    try {
      const cred = new PasswordCredential({ id: email, password, name });
      await navigator.credentials.store(cred);
    } catch (e) {
      // Never block login on this — saving credentials is a nice-to-have, not critical
      console.warn('Could not offer credential to browser:', e);
    }
  }

  const loginForm = document.getElementById('login-form');
  const loginError = document.getElementById('login-error');
  const loginSubmit = document.getElementById('login-submit');

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    loginError.hidden = true;
    loginSubmit.disabled = true;
    loginSubmit.textContent = 'Signing in…';

    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;

    try {
      const data = await Api.login(email, password);
      Auth.setToken(data.token);
      Auth.setUser(data.user);
      await offerToSaveCredential(email, password, data.user.full_name);
      window.location.href = 'dashboard.html';
    } catch (err) {
      loginError.textContent = err.message || 'Unable to sign in';
      loginError.hidden = false;
      loginSubmit.disabled = false;
      loginSubmit.textContent = 'Sign in';
    }
  });

  // Registration toggle
  const showRegisterBtn = document.getElementById('show-register');
  const registerForm = document.getElementById('register-form');
  showRegisterBtn.addEventListener('click', () => {
    const nowHidden = !registerForm.hidden;
    registerForm.hidden = nowHidden;
    showRegisterBtn.textContent = nowHidden ? 'Create an account' : 'Hide registration';
  });

  const roleSelect = document.getElementById('reg-role');
  const pinField = document.getElementById('reg-pin-field');
  roleSelect.addEventListener('change', () => {
    pinField.hidden = roleSelect.value !== 'taxpayer';
  });

  const registerError = document.getElementById('register-error');
  const registerSuccess = document.getElementById('register-success');
  const registerSubmit = document.getElementById('register-submit');

  registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    registerError.hidden = true;
    registerSuccess.hidden = true;
    registerSubmit.disabled = true;
    registerSubmit.textContent = 'Creating account…';

    const payload = {
      full_name: document.getElementById('reg-name').value.trim(),
      email: document.getElementById('reg-email').value.trim(),
      password: document.getElementById('reg-password').value,
      role: roleSelect.value,
    };

    try {
      await Api.register(payload);
      registerSuccess.textContent = 'Account created. You can now sign in above.';
      registerSuccess.hidden = false;
      registerForm.reset();
      pinField.hidden = true;
    } catch (err) {
      registerError.textContent = err.message || 'Unable to create account';
      registerError.hidden = false;
    } finally {
      registerSubmit.disabled = false;
      registerSubmit.textContent = 'Create account';
    }
  });
});
