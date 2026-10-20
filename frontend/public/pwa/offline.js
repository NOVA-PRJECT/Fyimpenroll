document.getElementById('retry').addEventListener('click', () => window.location.reload())
window.addEventListener('online', () => {
  document.getElementById('connection-status').textContent = 'Your device is connected again. Tap Try again to reconnect to the portal.'
})
