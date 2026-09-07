const fault = new URL(self.location.href).searchParams.get('fault');
self.onmessage = event => {
  if (fault === 'silent' || fault === 'messageerror') return;
  if (fault === 'malformed') { self.postMessage({ version: event.data.version, packed: null }); return; }
  throw new Error('Injected worker parse failure');
};
