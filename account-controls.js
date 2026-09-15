const petList = document.getElementById('petList');
const notice = document.getElementById('notice');

if (petList && notice) {
  const style = document.createElement('style');
  style.textContent = `
    .remove-tag{border:0;background:transparent;color:#66736c;font:inherit;font-weight:700;padding:10px 4px;text-decoration:underline;text-underline-offset:3px;cursor:pointer}
    .remove-tag:hover{color:#18231e}.owner-dialog{border:0;border-radius:24px;padding:0;max-width:min(92vw,440px);box-shadow:0 24px 70px rgba(18,43,31,.24)}
    .owner-dialog::backdrop{background:rgba(12,25,19,.52);backdrop-filter:blur(3px)}.owner-dialog-card{padding:26px}
    .owner-dialog h2{margin:0 0 8px;font-size:25px}.owner-dialog p{color:#637069;line-height:1.5;margin:0 0 20px}
    .owner-dialog label{display:grid;gap:8px;font-weight:750}.owner-dialog input{box-sizing:border-box;width:100%;border:1px solid #ccd7d1;border-radius:14px;padding:14px;font:inherit;margin-bottom:18px}
    .owner-dialog-actions{display:grid;grid-template-columns:1fr 1fr;gap:10px}.owner-dialog button{border:0;border-radius:14px;padding:13px;font:inherit;font-weight:750;cursor:pointer}
    .owner-dialog .cancel-remove{background:#edf4f0;color:#244233}.owner-dialog .confirm-remove{background:#173c2b;color:#fff}.owner-dialog button:disabled{opacity:.6;cursor:wait}
  `;
  document.head.append(style);

  const dialog = document.createElement('dialog');
  dialog.className = 'owner-dialog';
  dialog.innerHTML = `<form class="owner-dialog-card" method="dialog">
    <h2>Eliminar TAG</h2>
    <p>¿Estás seguro de eliminar este TAG? Se eliminarán todos los datos de la mascota.</p>
    <label>PIN del TAG<input id="removePin" type="password" inputmode="numeric" autocomplete="one-time-code" required></label>
    <div class="owner-dialog-actions"><button class="cancel-remove" value="cancel" type="button">Cancelar</button><button class="confirm-remove" type="submit">Eliminar TAG</button></div>
  </form>`;
  document.body.append(dialog);

  let selectedCode = '';
  function showNotice(message, error = false) {
    notice.textContent = message;
    notice.className = 'notice' + (error ? ' error' : '');
    notice.style.display = 'block';
    notice.setAttribute('role', error ? 'alert' : 'status');
  }
  function enhanceCards() {
    for (const card of petList.querySelectorAll('.pet')) {
      if (card.querySelector('.remove-tag')) continue;
      const edit = card.querySelector('a.edit[href]');
      const match = edit?.getAttribute('href')?.match(/^\/(\d{4,10})\?/);
      const actions = card.querySelector('.pet-actions');
      if (!match || !actions) continue;
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'remove-tag'; button.dataset.code = match[1];
      button.textContent = 'Eliminar TAG'; actions.append(button);
    }
  }
  new MutationObserver(enhanceCards).observe(petList, { childList: true, subtree: true });
  enhanceCards();

  petList.addEventListener('click', event => {
    const button = event.target.closest('.remove-tag');
    if (!button) return;
    selectedCode = button.dataset.code;
    dialog.querySelector('#removePin').value = '';
    dialog.showModal(); dialog.querySelector('#removePin').focus();
  });
  dialog.querySelector('.cancel-remove').addEventListener('click', () => dialog.close());
  dialog.querySelector('form').addEventListener('submit', async event => {
    event.preventDefault();
    const submit = dialog.querySelector('.confirm-remove');
    submit.disabled = true; submit.textContent = 'Eliminando…';
    try {
      const cfgResponse = await fetch('/api/auth-config', { cache: 'no-store' });
      const cfg = await cfgResponse.json();
      if (!cfgResponse.ok) throw new Error(cfg.error || 'Las cuentas no están disponibles.');
      const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.57.4/+esm');
      const client = createClient(cfg.supabaseUrl, cfg.supabasePublishableKey, { auth: { flowType: 'pkce' } });
      const { data: { session } } = await client.auth.getSession();
      if (!session) { location.replace('/iniciar-sesion'); return; }
      const response = await fetch('/api/account', { method: 'POST', headers: {
        'Content-Type': 'application/json', Authorization: 'Bearer ' + session.access_token
      }, body: JSON.stringify({ action: 'unlink', code: selectedCode, pin: dialog.querySelector('#removePin').value }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'No se pudo eliminar el TAG.');
      dialog.close(); showNotice('TAG eliminado. Todos los datos de la mascota fueron borrados y el TAG quedó libre.');
      setTimeout(() => location.reload(), 900);
    } catch (error) { showNotice(error.message || 'No pudimos conectarnos. Intentá nuevamente.', true); }
    finally { submit.disabled = false; submit.textContent = 'Eliminar TAG'; }
  });
}
