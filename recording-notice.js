/* The recording state is informational; this never changes recording controls. */
function startRecordingNotice(options) {
  const env = options.environment || window, doc = options.document || document;
  const nodes = options.nodes.filter(Boolean);
  let timer, controller = null, stopped = false;
  function show(status) {
    const active = !!status && (status.state === 'Recording' || !!status.activeId);
    nodes.forEach(node => {
      node.hidden = !active;
      const text = active ? 'Recording is active. Downloads are slowed to protect video capture. Pause recording in the car app for faster downloads.' : '';
      if (node.textContent !== text) node.textContent = text;
    });
  }
  async function poll() {
    if (stopped || doc.hidden || controller) return;
    const request = new AbortController(); controller = request;
    const timeout = env.setTimeout(() => request.abort(), 4000);
    try {
      const response = await options.fetcher('/api/v1/status', {signal: request.signal});
      if (!response.ok) throw new Error('Recorder status unavailable');
      const status = await response.json();
      if (!stopped && !request.signal.aborted) show(status);
    } catch (_) { if (!stopped) show(null); }
    finally {
      env.clearTimeout(timeout); controller = null;
      if (!stopped && !doc.hidden) timer = env.setTimeout(poll, 3000);
    }
  }
  function visibility() {
    env.clearTimeout(timer);
    if (doc.hidden) { if (controller) controller.abort(); }
    else poll();
  }
  function hide(event) { if (!event.persisted) stop(); else {env.clearTimeout(timer);if (controller) controller.abort();} }
  function stop() {
    stopped = true; env.clearTimeout(timer); if (controller) controller.abort();
    doc.removeEventListener('visibilitychange', visibility);
    env.removeEventListener('pagehide', hide); env.removeEventListener('pageshow', visibility);
  }
  doc.addEventListener('visibilitychange', visibility);
  env.addEventListener('pagehide', hide); env.addEventListener('pageshow', visibility);
  show(null); poll();
  return stop;
}
if (typeof module !== 'undefined') module.exports = {startRecordingNotice};
